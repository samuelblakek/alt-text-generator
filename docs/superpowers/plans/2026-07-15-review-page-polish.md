# Review Page Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Regenerate/Retry silently doing nothing mid-batch, make the review page's progress bar accurately reflect done/failed/processing/queued images, and add a click-to-expand image lightbox.

**Architecture:** `processJob`'s single fixed pass over pending/failed images becomes a loop that keeps discovering newly-`pending` images (from a mid-batch Regenerate/Retry) until nothing new is left, tracking attempted image IDs so a permanently-broken image isn't retried in a tight loop. The review page's progress bar and image-expansion are both pure frontend changes computed from data already fetched (no backend/schema changes for either).

**Tech Stack:** Next.js 14 App Router, TypeScript, Vitest (node environment only — no jsdom/component tests in this project).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-15-review-page-polish-design.md` — follow it exactly.
- Design system: `docs/design.md` — colors for the new progress-bar segments and legend must use existing Tailwind tokens: `bg-brand-primary` (done/skipped), `bg-danger` (failed), `bg-brand-accent/60` (processing) — no new hardcoded hex values.
- No backend/schema changes for the progress bar or lightbox — both are computed/rendered entirely from data the review page already fetches.
- The lightbox is image-only, closes via backdrop click or an explicit × button — no keyboard handling, no gallery navigation (per the approved mockup).
- This project has no jsdom/component test setup (`vitest.config.ts` runs `environment: 'node'` only) — frontend-only tasks are verified via `npx tsc --noEmit` plus a manual Browser-pane smoke test, not automated tests.

---

### Task 1: Fix `processJob` to pick up images regenerated mid-batch

**Files:**
- Modify: `src/lib/jobs/processJob.ts`
- Test: `tests/lib/jobs/processJob.test.ts`

**Interfaces:**
- Consumes: `isStopRequested(jobId)` from `src/lib/jobs/stopRequests.ts` (unchanged, already imported).
- Produces: no change to `processJob`'s exported signature (`processJob(jobId, deps): Promise<void>`) — behavior only. The existing test at the bottom of `processJob.test.ts` ("stops starting new images once a stop is requested...") must still pass unmodified after this change — it does, because marking every candidate's id as "attempted" before running its task means a stopped-and-skipped image is never re-selected as a candidate in a later loop pass within the same call, so it correctly stays `pending` and the loop terminates once nothing new remains.

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/jobs/processJob.test.ts`, inside the existing `describe('processJob', ...)` block, after the `'uses the job\'s stored model for every generateAltText call'` test and before the `'stops starting new images...'` test:

```ts
  it('picks up an image regenerated mid-batch by another still-running processJob call', async () => {
    const { generateAltText } = await import('../../../src/lib/gemini/generateAltText');
    const db = createDb(':memory:');
    const store = createJobStore(db);
    const job = store.createJob('test.csv', [
      { sku: 'SKU1', productName: 'Widget', imageId: '1', imageUrl: 'http://a/1.jpg', existingDescription: '', sortOrder: 0, slotIndex: 1 },
      { sku: 'SKU1', productName: 'Widget', imageId: '2', imageUrl: 'http://a/2.jpg', existingDescription: '', sortOrder: 1, slotIndex: 2 },
    ]);
    const images = store.getImages(job.id);
    const image2Id = images.find((i) => i.imageUrl === 'http://a/2.jpg')!.id;
    store.updateImageStatus(image2Id, { status: 'done', generatedAltText: 'original text before regenerate' });

    (generateAltText as any).mockImplementationOnce(async () => {
      // Simulate a Regenerate click on image 2 (already 'done') happening while
      // image 1 is still being processed by this same processJob() call.
      store.updateImageStatus(image2Id, { status: 'pending' });
      return 'A red widget on a white background shown here';
    });

    await processJob(job.id, { store, geminiClient: {} as any, maxConcurrency: 1 });

    const updated = store.getImages(job.id);
    const first = updated.find((i) => i.imageUrl === 'http://a/1.jpg');
    const second = updated.find((i) => i.imageUrl === 'http://a/2.jpg');
    expect(first?.status).toBe('done');
    expect(second?.status).toBe('done');
    expect(second?.generatedAltText).toBe('A red widget on a white background shown here');
    expect(generateAltText).toHaveBeenCalledTimes(2);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/jobs/processJob.test.ts`
Expected: FAIL — `second?.status` is `'pending'` (not `'done'`) and `generateAltText` was called only once, because the current single fixed pass over `getPendingOrFailedImages` never re-checks for newly-pending images after it starts.

- [ ] **Step 3: Write the implementation**

Replace the body of `src/lib/jobs/processJob.ts` with:

```ts
import pLimit from 'p-limit';
import type { GoogleGenerativeAI } from '@google/generative-ai';
import type { JobStore } from './jobStore';
import { fetchImage } from '../images/fetchImage';
import { downscaleImage } from '../images/downscale';
import { generateAltText } from '../gemini/generateAltText';
import { retryWithBackoff } from './retry';
import { isStopRequested } from './stopRequests';

export interface ProcessJobDeps {
  store: JobStore;
  geminiClient: GoogleGenerativeAI;
  maxConcurrency?: number;
}

export async function processJob(jobId: string, deps: ProcessJobDeps): Promise<void> {
  const concurrency = deps.maxConcurrency ?? Number(process.env.GEMINI_MAX_CONCURRENCY ?? 3);
  const limit = pLimit(concurrency);
  deps.store.resetStaleProcessing(jobId);
  const job = deps.store.getJob(jobId);
  const model = job?.model;

  const attemptedIds = new Set<number>();
  while (true) {
    const candidates = deps.store
      .getPendingOrFailedImages(jobId)
      .filter((image) => !attemptedIds.has(image.id));
    if (candidates.length === 0) break;
    candidates.forEach((image) => attemptedIds.add(image.id));

    await Promise.all(
      candidates.map((image) =>
        limit(async () => {
          if (isStopRequested(jobId)) return;
          deps.store.updateImageStatus(image.id, { status: 'processing' });
          try {
            const fetched = await fetchImage(image.imageUrl);
            const { buffer, mimeType } = await downscaleImage(fetched.buffer, fetched.contentType);
            const altText = await retryWithBackoff(() =>
              generateAltText(deps.geminiClient, {
                imageBuffer: buffer,
                mimeType,
                productName: image.productName,
                reviewerHint: image.reviewerHint ?? undefined,
                model,
              })
            );
            deps.store.updateImageStatus(image.id, { status: 'done', generatedAltText: altText, error: null });
          } catch (err) {
            deps.store.updateImageStatus(image.id, {
              status: 'failed',
              error: err instanceof Error ? err.message : 'Unknown error',
            });
          }
        })
      )
    );
  }

  deps.store.recomputeAllValidationFlags(jobId);
  deps.store.recomputeJobTotals(jobId);
}
```

(Only the middle section changed: the single `const images = ...; await Promise.all(images.map(...))` became a `while` loop with an `attemptedIds` set. The per-image task body inside `limit(async () => { ... })` is byte-for-byte identical to before.)

- [ ] **Step 4: Run the full test file to verify everything passes**

Run: `npx vitest run tests/lib/jobs/processJob.test.ts`
Expected: PASS (8 tests — the 7 existing ones, including the "stops starting new images..." stop test, plus the new one)

- [ ] **Step 5: Commit**

```bash
git add src/lib/jobs/processJob.ts tests/lib/jobs/processJob.test.ts
git commit -m "processJob: dynamically pick up images regenerated mid-batch"
```

---

### Task 2: Segmented progress bar

**Files:**
- Modify: `src/app/jobs/[id]/review/page.tsx`

**Interfaces:**
- Consumes: the existing `images` state array (`ImageRecord[]`, already fetched every 3s by `refresh()`) and the existing `job` state (`Job | null`) — no new fields needed from either.
- Produces: no new exports — this is the page component. Task 3 (lightbox) modifies a different part of the same file (the thumbnail `<img>` and a new modal near the end); apply this task first so Task 3's diff is written against the file as it stands after this task.

No automated test — this project has no jsdom/component test setup. Verify with `npx tsc --noEmit` plus a manual Browser-pane check.

- [ ] **Step 1: Replace the progress calculation**

In `src/app/jobs/[id]/review/page.tsx`, replace:

```ts
  const resolvedCount = job ? job.doneCount + job.skippedCount : 0;
  const progressPct = job && job.imageCount > 0 ? Math.round((resolvedCount / job.imageCount) * 100) : 0;
```

with:

```ts
  const resolvedCount = job ? job.doneCount + job.skippedCount : 0;
  const totalImages = images.length;
  const doneSegmentCount = images.filter((i) => i.status === 'done' || i.status === 'skipped').length;
  const failedSegmentCount = images.filter((i) => i.status === 'failed').length;
  const processingSegmentCount = images.filter((i) => i.status === 'processing').length;
  const doneSegmentPct = totalImages > 0 ? (doneSegmentCount / totalImages) * 100 : 0;
  const failedSegmentPct = totalImages > 0 ? (failedSegmentCount / totalImages) * 100 : 0;
  const processingSegmentPct = totalImages > 0 ? (processingSegmentCount / totalImages) * 100 : 0;
```

- [ ] **Step 2: Replace the progress bar JSX with a segmented bar + legend**

Replace:

```tsx
          {job && (
            <div className="flex items-center gap-3">
              <div className="h-1.5 w-40 overflow-hidden rounded-full bg-surface-muted">
                <div
                  className="h-full rounded-full bg-brand-accent transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <p className="text-sm text-text-primary/60">
                {resolvedCount} / {job.imageCount} done
                {job.failedCount > 0 && `, ${job.failedCount} failed`} · {JOB_STATUS_LABELS[job.status]}
              </p>
            </div>
          )}
```

with:

```tsx
          {job && (
            <div>
              <div className="flex items-center gap-3">
                <div className="h-1.5 w-40 overflow-hidden rounded-full bg-surface-muted">
                  <div className="flex h-full">
                    <div
                      className="h-full bg-brand-primary transition-all"
                      style={{ width: `${doneSegmentPct}%` }}
                    />
                    <div
                      className="h-full bg-danger transition-all"
                      style={{ width: `${failedSegmentPct}%` }}
                    />
                    <div
                      className="h-full bg-brand-accent/60 transition-all"
                      style={{ width: `${processingSegmentPct}%` }}
                    />
                  </div>
                </div>
                <p className="text-sm text-text-primary/60">
                  {resolvedCount} / {job.imageCount} done
                  {job.failedCount > 0 && `, ${job.failedCount} failed`} · {JOB_STATUS_LABELS[job.status]}
                </p>
              </div>
              <div className="mt-1.5 flex items-center gap-3 text-xs text-text-primary/50">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-sm bg-brand-primary" />
                  Done
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-sm bg-danger" />
                  Failed
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-sm bg-brand-accent/60" />
                  Processing
                </span>
              </div>
            </div>
          )}
```

Note: the legend always shows all three entries (Done, Failed, Processing) regardless of whether a given segment's count is currently zero — this is a deliberate simplification (no conditional show/hide logic), not an oversight.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Manual smoke test in the Browser pane**

1. Upload a small CSV (3-4 images) via the running dev server.
2. While it's processing, confirm the bar shows a light-blue segment for whatever's currently `processing`, and the track (grey) for the rest still queued.
3. If any image fails (or force one to fail, e.g. a broken URL), confirm a red segment appears and the bar still visually reaches full width once nothing is left running — it should NOT look "stuck" below 100%.
4. Confirm the legend row (three small colored squares + labels) renders under the bar.

- [ ] **Step 5: Commit**

```bash
git add src/app/jobs/[id]/review/page.tsx
git commit -m "Review page: segmented progress bar reflecting done/failed/processing/queued"
```

---

### Task 3: Image lightbox

**Files:**
- Modify: `src/app/jobs/[id]/review/page.tsx`

**Interfaces:**
- Consumes: `ImageRecord.imageUrl` (existing field).
- Produces: no new exports — page component only. Depends on Task 2 having already landed in this file (this task only touches the state declarations near the top, the thumbnail `<img>`, and adds a new modal block near the end of the returned JSX — none of which overlap Task 2's changes).

No automated test — same reasoning as Task 2.

- [ ] **Step 1: Add lightbox state**

In `src/app/jobs/[id]/review/page.tsx`, replace:

```ts
  const [job, setJob] = useState<Job | null>(null);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [exportError, setExportError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState(false);
  const [hints, setHints] = useState<Record<number, string>>({});
```

with:

```ts
  const [job, setJob] = useState<Job | null>(null);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [exportError, setExportError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState(false);
  const [hints, setHints] = useState<Record<number, string>>({});
  const [expandedImageUrl, setExpandedImageUrl] = useState<string | null>(null);
```

- [ ] **Step 2: Make the thumbnail clickable**

Replace:

```tsx
                  <img
                    src={image.imageUrl}
                    alt=""
                    className="h-24 w-24 shrink-0 rounded-md border border-border-light object-cover"
                  />
```

with:

```tsx
                  <img
                    src={image.imageUrl}
                    alt=""
                    className="h-24 w-24 shrink-0 cursor-pointer rounded-md border border-border-light object-cover"
                    onClick={() => setExpandedImageUrl(image.imageUrl)}
                  />
```

- [ ] **Step 3: Add the lightbox modal**

Find the end of the component's JSX:

```tsx
        </section>
      ))}
    </main>
  );
}
```

Replace it with (adding the modal block between the closing `))}` and `</main>`):

```tsx
        </section>
      ))}
      {expandedImageUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setExpandedImageUrl(null)}
        >
          <img
            src={expandedImageUrl}
            alt=""
            className="max-h-[85vh] max-w-[85vw] rounded-md object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setExpandedImageUrl(null)}
            className="absolute right-6 top-6 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-xl text-white transition-colors hover:bg-white/20"
            aria-label="Close"
          >
            ×
          </button>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Manual smoke test in the Browser pane**

1. On the review page, click a product image thumbnail.
2. Confirm a dark overlay appears with the image shown larger, centered, and a × button in the top-right corner.
3. Click the enlarged image itself — confirm the modal does NOT close.
4. Click the dark backdrop (outside the image) — confirm the modal closes.
5. Re-open it and click the × button — confirm it also closes.

- [ ] **Step 6: Commit**

```bash
git add src/app/jobs/[id]/review/page.tsx
git commit -m "Review page: add click-to-expand image lightbox"
```

---

## Full verification (after all 3 tasks)

- [ ] Run the full test suite: `npx vitest run` — expect all tests passing (85 existing + 1 new = 86).
- [ ] Run `npx tsc --noEmit` — expect no errors.
- [ ] Manual end-to-end smoke test per this project's established practice: upload a real small batch, click Regenerate on a done image while others are still processing and confirm it actually gets reprocessed (not silently ignored), confirm the segmented progress bar and legend look right through a batch with a mix of statuses, and confirm the lightbox opens/closes correctly on several images.
