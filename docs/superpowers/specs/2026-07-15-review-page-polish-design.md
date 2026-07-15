# Review Page Polish — Design Spec

Date: 2026-07-15

## Overview

Three independent review-page fixes driven by user/colleague feedback after using the
stop/resume feature:

1. Regenerate/Retry silently does nothing if clicked while the initial batch is still processing.
2. The progress bar doesn't accurately reflect what's happening (failures don't count
   as resolved, no visual distinction for in-flight vs queued images).
3. Clicking a product image thumbnail should show a larger view.

## Goals

- Regenerate/Retry always actually works, even while a batch is mid-run.
- The progress bar visually reaches "full" once nothing is left running or queued —
  including when there are permanent failures — and shows done/failed/processing/queued
  as distinct segments.
- Clicking any product image thumbnail on the review page opens it larger in a modal.

## Non-goals

- No ad-hoc URL input (separate future phase, its own spec).
- No PIM writeback (deferred — tracked in project memory, not this spec).
- No change to per-image row layout beyond making the thumbnail clickable.
- No keyboard (Escape) handling or multi-image gallery navigation in the lightbox —
  closes via backdrop click or an explicit close button only, per the approved mockup.

## Design

### 1. Regenerate/Retry fix (`src/lib/jobs/processJob.ts`)

**Root cause:** `processJob` captures the list of pending/failed images **once** at the
start via `getPendingOrFailedImages`, then processes exactly that fixed list. If a
reviewer clicks Regenerate/Retry on an image while the batch is still running, the PATCH
route resets that image to `pending` — but since a process is already running, no new
`processJob` call starts (guarded by `runningJobs.isRunning`), and the *already-running*
call has no way to discover the newly-pending image. It sits `pending` until the batch
fully finishes and something manually re-triggers `/process`.

**Fix:** replace the one-shot pass with a loop that keeps re-polling for new work,
tracking image IDs already attempted this invocation so a single permanently-broken
image isn't retried in a tight loop:

```ts
const attemptedIds = new Set<number>();
while (true) {
  const candidates = deps.store
    .getPendingOrFailedImages(jobId)
    .filter((img) => !attemptedIds.has(img.id));
  if (candidates.length === 0) break;
  candidates.forEach((img) => attemptedIds.add(img.id));
  await Promise.all(
    candidates.map((image) =>
      limit(async () => {
        if (isStopRequested(jobId)) return;
        // ...unchanged per-image body (fetch/downscale/generate/update)...
      })
    )
  );
}
```

This preserves the existing "one attempt per image per `processJob()` call" semantics
(so a permanently-broken image doesn't spin forever within one run), while letting a
still-running batch pick up newly-`pending` images from a mid-batch Regenerate/Retry
click on its next loop pass — directly fixing the reported bug.

It also composes correctly with the Stop feature shipped previously: if a stop is
requested mid-loop, every currently-pending image is marked "attempted" before its task
runs, so a stopped task is skipped (left `pending`, per existing behavior) and the loop
naturally terminates on its next pass since there's nothing new to attempt.

**Known limitation (acceptable, not fixed by this spec):** if the *same* image is
regenerated a second time while its first regeneration from this run is still being
processed, the second click won't be picked up until a later `processJob` invocation,
since its id is already in `attemptedIds`. This is a narrow edge case (double-clicking
regenerate on one image while it's already mid-flight) and shares the same tradeoff
that prevents infinite reprocessing of a permanently-failing image.

No API route changes are needed — `PATCH /api/jobs/:id/images/:imageId` (retry/regenerate)
already resets the image to `pending`; the fix is entirely inside `processJob`'s loop.

### 2. Segmented progress bar (`src/app/jobs/[id]/review/page.tsx`)

Computed entirely client-side from the `images` array the review page already fetches —
no backend or schema changes needed.

Four segments, left to right, each proportional to `imageCount`:

| Segment | Color | Source |
|---|---|---|
| Done/Skipped | `bg-brand-primary` | `images.filter(i => i.status === 'done' \|\| i.status === 'skipped').length` |
| Failed | `bg-danger` | `images.filter(i => i.status === 'failed').length` |
| Processing | `bg-brand-accent` | `images.filter(i => i.status === 'processing').length` |
| Queued | *(implicit)* the bar's existing `bg-surface-muted` track | `images.filter(i => i.status === 'pending').length` |

Rendered as one bar: the first three segments as sequential flex children with
percentage widths, sitting on the existing muted track (which itself represents
"queued" — no separate div needed for it, since it's just whatever width isn't
covered by the other three).

Since done+skipped+failed+processing+pending always sums to `imageCount` by
construction, the bar inherently reaches full visual width once nothing is left
running or queued — including when there are permanent failures. This directly fixes
the "looks stuck below 100%" complaint.

**Legend:** a small colored square swatch (an 8×8px rounded `<span>` with the segment's
background color) immediately before each label — e.g. a navy square before "Done", a
red square before "Failed" — using the same color tokens as the bar itself, not text
descriptions or emoji.

The existing text line beside the bar (`{resolvedCount} / {job.imageCount} done,
{failedCount} failed · {status}`) is unchanged — it was already numerically accurate;
only the bar's visual fill was misleading.

### 3. Image lightbox (`src/app/jobs/[id]/review/page.tsx`)

- New component state: `expandedImageUrl: string | null`.
- Each thumbnail `<img>` gains `onClick={() => setExpandedImageUrl(image.imageUrl)}`
  and a pointer cursor (`cursor-pointer`).
- When `expandedImageUrl` is set, render a fixed, full-viewport dark-backdrop overlay
  (`fixed inset-0 bg-black/80`, centered flex) containing the image at a larger,
  viewport-constrained size (`max-h-[85vh] max-w-[85vw]`) and a small close (×) button
  in the corner.
- Closing: clicking the backdrop itself (not the image) or the × button sets
  `expandedImageUrl` back to `null`. Clicking the image itself does nothing (does not
  close), so a reviewer can click the enlarged image without accidentally dismissing
  it — implemented with `e.stopPropagation()` in the enlarged image's own `onClick`,
  so the click never bubbles up to the backdrop's close handler.
- No routing, no gallery/next-prev navigation, no keyboard handling — a single
  click-to-open, click-to-close modal, per the approved mockup (Option A).

## Testing

- `processJob.test.ts`: new test simulating a mid-batch regenerate. Set up a 2-image
  job with `maxConcurrency: 1` where image 1 starts `pending`/`failed` and image 2
  starts `done`. From within the mocked `generateAltText` call triggered for image 1,
  directly call `store.updateImageStatus(image2.id, { status: 'pending' })` to simulate
  a Regenerate click on the already-`done` image 2 happening mid-run. Assert image 2
  ends up reprocessed (`generateAltText` called twice total, image 2's
  `generatedAltText` updated) within this single `processJob()` call, rather than being
  left behind until a separate invocation.
- No automated tests for the progress bar or lightbox (frontend-only; this project has
  no jsdom/component test setup, consistent with how the stop/resume feature's UI tasks
  were verified) — checked via `npx tsc --noEmit` plus a manual Browser-pane smoke test
  covering: a batch with a mix of done/failed/processing/pending images (bar segments
  and legend match), and clicking a thumbnail opens/closes the lightbox correctly.
