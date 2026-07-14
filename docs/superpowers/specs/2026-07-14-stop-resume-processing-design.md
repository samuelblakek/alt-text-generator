# Stop / Resume Processing + In-Progress Row Placeholder — Design Spec

Date: 2026-07-14

## Overview

Two related changes to the review page (`/jobs/[id]/review`):

1. A **Stop Processing** button, so a reviewer can pause an in-progress batch
   (e.g. to fix a bad hint, reconsider the model choice, or just stop
   burning Gemini calls) without losing progress, plus a way to resume or
   abandon the job afterward.
2. Replacing the empty, editable textarea currently shown for images that
   haven't been processed yet with a placeholder that makes clear the image
   is still queued or in-flight, rather than looking broken.

## Goals

- Let a reviewer stop a running batch and have it actually stop starting
  new Gemini calls, without losing any already-generated alt text.
- Let a reviewer resume a stopped batch from where it left off.
- Let a reviewer abandon a stopped (or any) batch and start a new one from
  the upload page.
- Make the review page honest about per-image state: don't show an empty
  editable box for an image that hasn't been generated yet.

## Non-goals

- Not aborting in-flight Gemini/fetch requests already sent — a stop only
  prevents *new* images from starting. In-flight ones (at most
  `GEMINI_MAX_CONCURRENCY`, currently 3) finish normally.
- Not persisting the stop flag to SQLite — it's in-memory only, mirroring
  the existing `runningJobs.ts` pattern. If the Fly machine restarts mid-job
  (already a pre-existing edge case, not introduced by this change), the
  stop flag is lost along with the in-memory "running" state — the job
  simply looks like nothing is running, and Resume behaves the same as it
  would for any other stopped job.
- Not changing what "done", "failed", or "skipped" image rows look like —
  only pending/processing rows change.

## Design

### Stop / resume mechanics

New module `src/lib/jobs/stopRequests.ts`, mirroring the existing
`runningJobs.ts` in-memory `Set<string>` pattern:

```ts
export function requestStop(jobId: string): void
export function clearStop(jobId: string): void
export function isStopRequested(jobId: string): boolean
```

`processJob.ts` checks `isStopRequested(jobId)` at the top of each per-image
task (inside the `limit(async () => { ... })` callback), before doing any
work. If a stop was requested, the task returns immediately without
touching that image's status — it stays exactly as it was (`pending` or
`failed`), ready to be picked up on the next run.

New endpoint `POST /api/jobs/[id]/stop`: calls `requestStop(jobId)`, returns
`202 { status: 'stop_requested' }`. Does not touch `runningJobs` — the
already-running `processJob` call will finish its remaining in-flight tasks
and resolve on its own, at which point `runningJobs.finish()` fires as it
does today.

`POST /api/jobs/[id]/process` (the existing endpoint, already called once
right after upload) gains one line: `clearStop(jobId)` before calling
`processJob`. This means the same endpoint serves as "start" and "Resume" —
no separate resume endpoint needed. The existing `already_processing`
early-return (via `runningJobs.isRunning`) is unchanged, so double-clicking
Resume is already safe.

### Status API changes

`GET /api/jobs/[id]/status` response gains two fields:

```ts
{
  ...existing fields,
  isRunning: boolean,       // runningJobs.isRunning(jobId)
  stopRequested: boolean,   // stopRequests.isStopRequested(jobId)
}
```

### Review page UI — job-level controls

The `Job` interface (frontend) gains `isRunning` and `stopRequested`. The
button cluster under the progress bar (left-aligned, below the existing
progress bar/status line) renders one of four states:

| Condition | UI |
|---|---|
| `job.status === 'complete'` | nothing (unchanged from today) |
| `isRunning && !stopRequested` | **Stop Processing** button → `POST /stop` |
| `isRunning && stopRequested` | disabled **Stopping…** label (no action) |
| `!isRunning && job.status !== 'complete'` | red **Process Stopped** label + **Resume** button (→ `POST /process`, same call the upload page already makes) + **Start New Batch** button (→ navigates to `/`) |

`Start New Batch` does not touch the current job at all — it's the same
destination as the existing "← Upload another file" link (which stays
where it is, for use while a job is still actively running).

### Review page UI — per-image placeholder

For any image where `status === 'pending' || status === 'processing'`,
replace the textarea + hint input + validation pills + regenerate/retry
button row with a single placeholder block:

- Thumbnail stays as-is (the image URL comes from the CSV, not from
  Gemini, so it's available regardless of processing status).
- Placeholder: a pulsing skeleton bar (matching the textarea's rough
  dimensions) plus small muted text: "Waiting to process…" for `pending`,
  "Generating alt text…" for `processing`.
- The existing status pill (`STATUS_LABELS`) still renders above/beside the
  placeholder, same as it does for done/failed/skipped rows today.

`done`, `failed`, and `skipped` rows are unchanged: full textarea, hint
input, validation pills, regenerate/retry buttons, exactly as today.

## Testing plan

- Unit tests for `stopRequests.ts` (request/clear/query, mirrors existing
  `runningJobs.test.ts` if one exists, otherwise a small new test file).
- `processJob.test.ts`: a test that requests a stop mid-batch (e.g. via a
  fake `deps` that calls `requestStop` after the first image starts) and
  asserts remaining images stay `pending` and Gemini is not called for them.
- Route tests for `POST /api/jobs/[id]/stop` and the updated
  `POST /api/jobs/[id]/process` (asserts it clears any prior stop request).
- Route test for `GET /api/jobs/[id]/status` returning the two new fields.
- No new browser/E2E tests planned (project doesn't have any) — verify
  manually in the Browser pane per the project's existing smoke-test
  practice: start a batch, stop it mid-way, confirm remaining images stay
  pending and the button cluster shows the right state, resume, confirm it
  finishes.
