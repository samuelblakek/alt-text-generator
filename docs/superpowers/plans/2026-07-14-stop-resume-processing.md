# Stop / Resume Processing + In-Progress Row Placeholder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a reviewer stop an in-progress batch, resume it, or abandon it for a new upload — and stop showing an empty editable textarea for images that haven't been processed yet.

**Architecture:** A new in-memory `stopRequests` module (mirroring the existing `runningJobs` module) tracks per-job "stop requested" flags. `processJob` checks the flag before starting each per-image task and skips (without touching that image's row) if a stop was requested — already-in-flight tasks finish normally. A new `POST /stop` route sets the flag; the existing `POST /process` route (and the retry/regenerate path in the image PATCH route) clears it before running, so the same "start" machinery doubles as "resume." The status endpoint exposes `isRunning`/`stopRequested` so the review page can derive one of four button states. Per-image rows for `pending`/`processing` images render a placeholder instead of the textarea/hint/pill row.

**Tech Stack:** Next.js 14 App Router route handlers, TypeScript, Vitest (node environment, no jsdom/component tests in this project — frontend changes are verified via `tsc --noEmit` + manual Browser-pane smoke test, matching this project's existing practice).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-14-stop-resume-processing-design.md` — follow it exactly; this plan implements it task by task.
- Design system: `docs/design.md` — primary action buttons (Stop Processing, Resume, Start New Batch, Process Stopped label) are Title Case, matching the existing Export CSV / Upload & Start Processing buttons. Colors: `brand-primary` for forward actions, `danger` for stop/stopped states, per the palette table in `docs/design.md`.
- Do not persist the stop flag to SQLite — in-memory only, mirroring `src/lib/jobs/runningJobs.ts`.
- Do not abort in-flight fetch/Gemini calls — a stop only prevents new per-image tasks from starting.
- All new/modified test files run via `npx vitest run <path>` (Node 24 must be on PATH — see this project's `CLAUDE.md` for the exact `nvm` invocation on this machine).

---

### Task 1: `stopRequests` in-memory module

**Files:**
- Create: `src/lib/jobs/stopRequests.ts`
- Test: `tests/lib/jobs/stopRequests.test.ts`

**Interfaces:**
- Produces: `requestStop(jobId: string): void`, `clearStop(jobId: string): void`, `isStopRequested(jobId: string): boolean` — used directly (module import, not via a `deps` object) by `processJob.ts` (Task 2) and by the route handlers in Tasks 3–4.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/jobs/stopRequests.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { requestStop, clearStop, isStopRequested } from '../../../src/lib/jobs/stopRequests';

describe('stopRequests', () => {
  beforeEach(() => {
    clearStop('job-1');
    clearStop('job-2');
  });

  it('reports false for a job that has never had a stop requested', () => {
    expect(isStopRequested('job-1')).toBe(false);
  });

  it('reports true after requestStop, and only for that job id', () => {
    requestStop('job-1');
    expect(isStopRequested('job-1')).toBe(true);
    expect(isStopRequested('job-2')).toBe(false);
  });

  it('reports false again after clearStop', () => {
    requestStop('job-1');
    clearStop('job-1');
    expect(isStopRequested('job-1')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/jobs/stopRequests.test.ts`
Expected: FAIL — cannot find module `../../../src/lib/jobs/stopRequests`

- [ ] **Step 3: Write the implementation**

Create `src/lib/jobs/stopRequests.ts`:

```ts
// src/lib/jobs/stopRequests.ts
// Shared in-memory guard for a reviewer-requested stop, mirroring runningJobs.ts.
// A stop only prevents new per-image tasks in processJob from starting; it does
// not abort in-flight fetch/Gemini calls already underway.
const stopRequests = new Set<string>();

export function requestStop(jobId: string): void {
  stopRequests.add(jobId);
}

export function clearStop(jobId: string): void {
  stopRequests.delete(jobId);
}

export function isStopRequested(jobId: string): boolean {
  return stopRequests.has(jobId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/jobs/stopRequests.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/jobs/stopRequests.ts tests/lib/jobs/stopRequests.test.ts
git commit -m "Add in-memory stopRequests module for pausing job processing"
```

---

### Task 2: `processJob` skips new tasks once a stop is requested

**Files:**
- Modify: `src/lib/jobs/processJob.ts`
- Test: `tests/lib/jobs/processJob.test.ts`

**Interfaces:**
- Consumes: `isStopRequested(jobId: string): boolean` from Task 1 (`src/lib/jobs/stopRequests.ts`).
- Produces: no change to `processJob`'s existing exported signature (`processJob(jobId, deps): Promise<void>`) — behavior only.

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/jobs/processJob.test.ts` (inside the existing `describe('processJob', ...)` block, after the last test):

```ts
  it('stops starting new images once a stop is requested, leaving the rest pending', async () => {
    const { generateAltText } = await import('../../../src/lib/gemini/generateAltText');
    const { requestStop, clearStop } = await import('../../../src/lib/jobs/stopRequests');
    const db = createDb(':memory:');
    const store = createJobStore(db);
    const job = store.createJob('test.csv', [
      { sku: 'SKU1', productName: 'Widget', imageId: '1', imageUrl: 'http://a/1.jpg', existingDescription: '', sortOrder: 0, slotIndex: 1 },
      { sku: 'SKU1', productName: 'Widget', imageId: '2', imageUrl: 'http://a/2.jpg', existingDescription: '', sortOrder: 1, slotIndex: 2 },
    ]);
    clearStop(job.id);
    (generateAltText as any).mockImplementationOnce(async () => {
      requestStop(job.id);
      return 'A red widget on a white background shown here';
    });

    await processJob(job.id, { store, geminiClient: {} as any, maxConcurrency: 1 });

    const images = store.getImages(job.id);
    const first = images.find((i) => i.imageUrl === 'http://a/1.jpg');
    const second = images.find((i) => i.imageUrl === 'http://a/2.jpg');
    expect(first?.status).toBe('done');
    expect(second?.status).toBe('pending');
    expect(generateAltText).toHaveBeenCalledTimes(1);
    clearStop(job.id);
  });
```

Note: `maxConcurrency: 1` is required for determinism — it guarantees image 1's task (including its DB write to `done`) fully completes before image 2's task is dequeued, so image 2's stop-check reliably sees the flag set by image 1's mocked `generateAltText` call.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/jobs/processJob.test.ts`
Expected: FAIL — `second?.status` is `'done'` instead of `'pending'` (no stop-check exists yet, so image 2 processes normally)

- [ ] **Step 3: Write the implementation**

Modify `src/lib/jobs/processJob.ts`:

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
  const images = deps.store.getPendingOrFailedImages(jobId);

  await Promise.all(
    images.map((image) =>
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

  deps.store.recomputeAllValidationFlags(jobId);
  deps.store.recomputeJobTotals(jobId);
}
```

(Only two lines changed: the new `isStopRequested` import, and the `if (isStopRequested(jobId)) return;` guard at the top of the per-image task.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/jobs/processJob.test.ts`
Expected: PASS (7 tests — the 6 existing plus the new one)

- [ ] **Step 5: Commit**

```bash
git add src/lib/jobs/processJob.ts tests/lib/jobs/processJob.test.ts
git commit -m "processJob: skip starting new images once a stop is requested"
```

---

### Task 3: `POST /api/jobs/[id]/stop` route

**Files:**
- Create: `src/app/api/jobs/[id]/stop/route.ts`
- Test: `tests/app/api/jobs/id-stop.test.ts`

**Interfaces:**
- Consumes: `jobStore.getJob(jobId)` (existing, from `src/lib/jobs/jobStoreSingleton.ts`); `requestStop(jobId)` from Task 1.
- Produces: `POST /api/jobs/:id/stop` → `404 { error: 'Job not found' }` if the job doesn't exist, else `202 { status: 'stop_requested' }`. Consumed by the review page's `handleStop` in Task 6.

- [ ] **Step 1: Write the failing test**

Create `tests/app/api/jobs/id-stop.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../src/lib/jobs/jobStoreSingleton', () => ({
  jobStore: { getJob: vi.fn() },
}));
vi.mock('../../../../src/lib/jobs/stopRequests', () => ({
  requestStop: vi.fn(),
}));

import { POST } from '../../../../src/app/api/jobs/[id]/stop/route';
import { jobStore } from '../../../../src/lib/jobs/jobStoreSingleton';
import * as stopRequests from '../../../../src/lib/jobs/stopRequests';

describe('POST /api/jobs/:id/stop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when the job does not exist', async () => {
    (jobStore.getJob as any).mockReturnValue(undefined);
    const response = await POST({} as any, { params: { id: 'missing' } });
    expect(response.status).toBe(404);
  });

  it('requests a stop for the job and returns 202', async () => {
    (jobStore.getJob as any).mockReturnValue({ id: 'job-1', status: 'processing' });
    const response = await POST({} as any, { params: { id: 'job-1' } });
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.status).toBe('stop_requested');
    expect(stopRequests.requestStop).toHaveBeenCalledWith('job-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/app/api/jobs/id-stop.test.ts`
Expected: FAIL — cannot find module `.../app/api/jobs/[id]/stop/route`

- [ ] **Step 3: Write the implementation**

Create `src/app/api/jobs/[id]/stop/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { jobStore } from '../../../../../lib/jobs/jobStoreSingleton';
import * as stopRequests from '../../../../../lib/jobs/stopRequests';

export const runtime = 'nodejs';

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const job = jobStore.getJob(params.id);
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  stopRequests.requestStop(params.id);
  return NextResponse.json({ status: 'stop_requested' }, { status: 202 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/app/api/jobs/id-stop.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/jobs/[id]/stop/route.ts tests/app/api/jobs/id-stop.test.ts
git commit -m "Add POST /api/jobs/:id/stop route"
```

---

### Task 4: Clear the stop flag everywhere `processJob` is (re)started

**Files:**
- Modify: `src/app/api/jobs/[id]/process/route.ts`
- Modify: `src/app/api/jobs/[id]/images/[imageId]/route.ts`
- Test: `tests/app/api/jobs/id-process.test.ts`
- Test: `tests/app/api/jobs/id-images.test.ts`

**Interfaces:**
- Consumes: `clearStop(jobId: string): void` from Task 1.
- Produces: no new exports — both routes' existing `POST`/`PATCH` behavior is unchanged except for clearing the flag before invoking `processJob`. Required so that: (a) clicking "Resume" on the review page (which calls `POST /process`, same as Task 6) actually resumes instead of immediately re-skipping every image; (b) the single-image retry/regenerate path (which calls `processJob` directly) isn't silently blocked by a leftover stop flag from an earlier batch stop.

- [ ] **Step 1: Write the failing tests**

Add to `tests/app/api/jobs/id-process.test.ts` — first add the mock (alongside the other `vi.mock` calls at the top of the file):

```ts
vi.mock('../../../../src/lib/jobs/stopRequests', () => ({
  clearStop: vi.fn(),
}));
```

And import it alongside the other imports:

```ts
import * as stopRequests from '../../../../src/lib/jobs/stopRequests';
```

Then add this test inside the existing `describe` block:

```ts
  it('clears any prior stop request before starting processing', async () => {
    (jobStore.getJob as any).mockReturnValue({ id: 'job-1', status: 'pending' });
    await POST({} as any, { params: { id: 'job-1' } });
    expect(stopRequests.clearStop).toHaveBeenCalledWith('job-1');
  });
```

Add to `tests/app/api/jobs/id-images.test.ts` — add the mock alongside the existing ones:

```ts
vi.mock('../../../../src/lib/jobs/stopRequests', () => ({
  clearStop: vi.fn(),
}));
```

Import it:

```ts
import * as stopRequests from '../../../../src/lib/jobs/stopRequests';
```

Add this test inside the existing `describe` block:

```ts
  it('clears any prior stop request before reprocessing on retry', async () => {
    (runningJobs.isRunning as any).mockReturnValue(false);
    const request = new Request('http://localhost', {
      method: 'PATCH',
      body: JSON.stringify({ retry: true }),
    });
    await PATCH(request as any, { params: { id: 'job-1', imageId: '1' } });
    expect(stopRequests.clearStop).toHaveBeenCalledWith('job-1');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/app/api/jobs/id-process.test.ts tests/app/api/jobs/id-images.test.ts`
Expected: FAIL — both new tests fail with "expected clearStop to have been called" (0 calls)

- [ ] **Step 3: Write the implementation**

Modify `src/app/api/jobs/[id]/process/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { jobStore } from '../../../../../lib/jobs/jobStoreSingleton';
import { processJob } from '../../../../../lib/jobs/processJob';
import { createGeminiClient } from '../../../../../lib/gemini/client';
import * as runningJobs from '../../../../../lib/jobs/runningJobs';
import * as stopRequests from '../../../../../lib/jobs/stopRequests';

export const runtime = 'nodejs';

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const job = jobStore.getJob(params.id);
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  if (runningJobs.isRunning(params.id)) {
    return NextResponse.json({ status: 'already_processing' }, { status: 202 });
  }

  runningJobs.start(params.id);
  stopRequests.clearStop(params.id);
  const geminiClient = createGeminiClient(process.env.GEMINI_API_KEY ?? '');

  processJob(params.id, { store: jobStore, geminiClient })
    .catch((err) => {
      console.error(`Job ${params.id} processing failed:`, err);
    })
    .finally(() => {
      runningJobs.finish(params.id);
    });

  return NextResponse.json({ status: 'started' }, { status: 202 });
}
```

Modify `src/app/api/jobs/[id]/images/[imageId]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { jobStore } from '../../../../../../lib/jobs/jobStoreSingleton';
import { processJob } from '../../../../../../lib/jobs/processJob';
import { createGeminiClient } from '../../../../../../lib/gemini/client';
import * as runningJobs from '../../../../../../lib/jobs/runningJobs';
import * as stopRequests from '../../../../../../lib/jobs/stopRequests';

export const runtime = 'nodejs';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; imageId: string } }
): Promise<NextResponse> {
  const body = (await request.json()) as {
    editedAltText?: string;
    retry?: boolean;
    regenerate?: boolean;
    hint?: string;
  };
  const imageId = Number(params.imageId);

  const images = jobStore.getImages(params.id);
  const image = images.find((i) => i.id === imageId);
  if (!image) {
    return NextResponse.json({ error: 'Image not found' }, { status: 404 });
  }

  if (typeof body.editedAltText === 'string') {
    jobStore.setEditedAltText(imageId, body.editedAltText);
    jobStore.recomputeValidationFlagsForSku(params.id, image.sku);
  }

  if (typeof body.hint === 'string') {
    jobStore.setReviewerHint(imageId, body.hint);
  }

  if (body.retry || body.regenerate) {
    jobStore.updateImageStatus(imageId, { status: 'pending', error: null });

    if (!runningJobs.isRunning(params.id)) {
      stopRequests.clearStop(params.id);
      runningJobs.start(params.id);
      const geminiClient = createGeminiClient(process.env.GEMINI_API_KEY ?? '');
      processJob(params.id, { store: jobStore, geminiClient, maxConcurrency: 1 })
        .catch((err) => {
          console.error(`Reprocess for image ${imageId} failed:`, err);
        })
        .finally(() => {
          runningJobs.finish(params.id);
        });
    }
  }

  const updated = jobStore.getImages(params.id).find((i) => i.id === imageId);
  return NextResponse.json(updated);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/app/api/jobs/id-process.test.ts tests/app/api/jobs/id-images.test.ts`
Expected: PASS (all tests in both files)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/jobs/[id]/process/route.ts src/app/api/jobs/[id]/images/[imageId]/route.ts tests/app/api/jobs/id-process.test.ts tests/app/api/jobs/id-images.test.ts
git commit -m "Clear any pending stop request wherever processing is (re)started"
```

---

### Task 5: `GET /api/jobs/[id]/status` returns `isRunning` and `stopRequested`

**Files:**
- Modify: `src/app/api/jobs/[id]/status/route.ts`
- Test: `tests/app/api/jobs/id-status.test.ts` (new file)

**Interfaces:**
- Consumes: `runningJobs.isRunning(jobId)` (existing), `stopRequests.isStopRequested(jobId)` from Task 1.
- Produces: `GET /api/jobs/:id/status` response shape becomes `{ ...Job fields, isRunning: boolean, stopRequested: boolean }`. Consumed by the review page's `Job` interface in Task 6.

- [ ] **Step 1: Write the failing test**

Create `tests/app/api/jobs/id-status.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../src/lib/jobs/jobStoreSingleton', () => ({
  jobStore: { getJob: vi.fn() },
}));
vi.mock('../../../../src/lib/jobs/runningJobs', () => ({
  isRunning: vi.fn(),
}));
vi.mock('../../../../src/lib/jobs/stopRequests', () => ({
  isStopRequested: vi.fn(),
}));

import { GET } from '../../../../src/app/api/jobs/[id]/status/route';
import { jobStore } from '../../../../src/lib/jobs/jobStoreSingleton';
import * as runningJobs from '../../../../src/lib/jobs/runningJobs';
import * as stopRequests from '../../../../src/lib/jobs/stopRequests';

describe('GET /api/jobs/:id/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when the job does not exist', async () => {
    (jobStore.getJob as any).mockReturnValue(undefined);
    const response = await GET({} as any, { params: { id: 'missing' } });
    expect(response.status).toBe(404);
  });

  it('includes isRunning and stopRequested alongside the job fields', async () => {
    (jobStore.getJob as any).mockReturnValue({ id: 'job-1', status: 'processing', imageCount: 3 });
    (runningJobs.isRunning as any).mockReturnValue(true);
    (stopRequests.isStopRequested as any).mockReturnValue(false);

    const response = await GET({} as any, { params: { id: 'job-1' } });
    const body = await response.json();
    expect(body).toMatchObject({ id: 'job-1', status: 'processing', imageCount: 3, isRunning: true, stopRequested: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/app/api/jobs/id-status.test.ts`
Expected: FAIL — second test's `body` has no `isRunning`/`stopRequested` keys

- [ ] **Step 3: Write the implementation**

Modify `src/app/api/jobs/[id]/status/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { jobStore } from '../../../../../lib/jobs/jobStoreSingleton';
import * as runningJobs from '../../../../../lib/jobs/runningJobs';
import * as stopRequests from '../../../../../lib/jobs/stopRequests';

export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const job = jobStore.getJob(params.id);
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }
  return NextResponse.json({
    ...job,
    isRunning: runningJobs.isRunning(params.id),
    stopRequested: stopRequests.isStopRequested(params.id),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/app/api/jobs/id-status.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/jobs/[id]/status/route.ts tests/app/api/jobs/id-status.test.ts
git commit -m "status route: expose isRunning and stopRequested"
```

---

### Task 6: Review page — Stop / Stopping / Process Stopped + Resume + Start New Batch

**Files:**
- Modify: `src/app/jobs/[id]/review/page.tsx`

**Interfaces:**
- Consumes: `POST /api/jobs/:id/stop` (Task 3), `POST /api/jobs/:id/process` (existing, now also clears the stop flag per Task 4), `GET /api/jobs/:id/status` now returning `isRunning`/`stopRequested` (Task 5).
- Produces: no new exports — this is the page component. Task 7 modifies the same file's per-image rendering; apply Task 6 first since Task 7's replacement block is written against the file as it stands after this task.

No automated test for this task — this project has no jsdom/component test setup (`vitest.config.ts` runs `environment: 'node'` only); frontend changes are verified with `tsc --noEmit` plus a manual Browser-pane smoke test, matching how the prior UI-polish work in this project was verified.

- [ ] **Step 1: Update the `Job` interface**

In `src/app/jobs/[id]/review/page.tsx`, replace:

```ts
interface Job {
  id: string;
  status: 'pending' | 'processing' | 'complete';
  imageCount: number;
  doneCount: number;
  failedCount: number;
  skippedCount: number;
}
```

with:

```ts
interface Job {
  id: string;
  status: 'pending' | 'processing' | 'complete';
  imageCount: number;
  doneCount: number;
  failedCount: number;
  skippedCount: number;
  isRunning: boolean;
  stopRequested: boolean;
}
```

- [ ] **Step 2: Add `handleStop` and `handleResume`**

In the same file, immediately after the existing `handleRegenerate` function (right before `async function handleExport(confirm = false) {`), add:

```ts
  async function handleStop() {
    try {
      await fetch(`/api/jobs/${params.id}/stop`, { method: 'POST' });
    } catch {
      setConnectionError(true);
      return;
    }
    refresh();
  }

  async function handleResume() {
    try {
      await fetch(`/api/jobs/${params.id}/process`, { method: 'POST' });
    } catch {
      setConnectionError(true);
      return;
    }
    refresh();
  }
```

- [ ] **Step 3: Add the button cluster under the progress bar**

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
        </div>
```

with:

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
          {job && job.status !== 'complete' && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {job.isRunning && !job.stopRequested && (
                <button
                  onClick={handleStop}
                  className="rounded-full border border-danger px-5 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger hover:text-white"
                >
                  Stop Processing
                </button>
              )}
              {job.isRunning && job.stopRequested && (
                <span className="rounded-full bg-surface-muted px-5 py-2 text-sm font-medium text-text-primary/50">
                  Stopping…
                </span>
              )}
              {!job.isRunning && (
                <>
                  <span className="rounded-full bg-danger/10 px-5 py-2 text-sm font-medium text-danger">
                    Process Stopped
                  </span>
                  <button
                    onClick={handleResume}
                    className="rounded-full bg-brand-primary px-5 py-2 text-sm font-medium text-white shadow-[0_10px_15px_rgba(30,55,113,0.3)] transition-opacity hover:opacity-90"
                  >
                    Resume
                  </button>
                  <a
                    href="/"
                    className="rounded-full border border-brand-primary px-5 py-2 text-sm font-medium text-brand-primary transition-colors hover:bg-brand-primary hover:text-white"
                  >
                    Start New Batch
                  </a>
                </>
              )}
            </div>
          )}
        </div>
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Manual smoke test in the Browser pane**

1. Upload a small CSV (2-3 images) via the running dev server.
2. On the review page, while it's processing, confirm the **Stop Processing** button appears under the progress bar.
3. Click it. Confirm it briefly shows **Stopping…**, then switches to **Process Stopped** (red) + **Resume** + **Start New Batch**, and that any image still `pending` stays `pending` (doesn't silently become `done`).
4. Click **Resume**. Confirm processing continues and the button cluster switches back to **Stop Processing**, then disappears once the job completes.
5. Click **Start New Batch** (from the stopped state) and confirm it navigates to `/`.

- [ ] **Step 6: Commit**

```bash
git add src/app/jobs/[id]/review/page.tsx
git commit -m "Review page: add Stop/Resume/Start New Batch controls"
```

---

### Task 7: Review page — placeholder for pending/processing image rows

**Files:**
- Modify: `src/app/jobs/[id]/review/page.tsx`

**Interfaces:**
- Consumes: `ImageRecord.status` (existing field), `STATUS_STYLES`/`STATUS_LABELS` (existing constants in this file).
- Produces: no new exports. Depends on Task 6 having already landed in this file (this task only touches the per-image row JSX, further down the same file).

No automated test — same reasoning as Task 6.

- [ ] **Step 1: Replace the per-image row rendering**

In `src/app/jobs/[id]/review/page.tsx`, replace:

```tsx
            {productImages.map((image) => (
              <div key={image.id} className="flex gap-4 border-t border-border-light pt-5 first:border-t-0 first:pt-0">
                <img
                  src={image.imageUrl}
                  alt=""
                  className="h-24 w-24 shrink-0 rounded-md border border-border-light object-cover"
                />
                <div className="flex-1">
                  <textarea
                    className="w-full rounded-md border border-border-light p-2.5 text-sm text-text-primary focus:border-brand-accent"
                    defaultValue={image.editedAltText ?? image.generatedAltText ?? ''}
                    onBlur={(e) => handleEdit(image.id, e.target.value)}
                    rows={2}
                  />
                  <input
                    type="text"
                    className="mt-2 w-full rounded-md border border-dashed border-border-light bg-surface-muted p-2 text-xs text-text-primary/80 focus:border-brand-accent"
                    placeholder="Optional correction, e.g. this is a stopwatch, not a mug"
                    value={hints[image.id] ?? ''}
                    onChange={(e) =>
                      setHints((prev) => ({ ...prev, [image.id]: e.target.value }))
                    }
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                    <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_STYLES[image.status]}`}>
                      {STATUS_LABELS[image.status]}
                    </span>
                    {image.validationFlags && !image.validationFlags.wordCountOk && (
                      <span className="rounded-full bg-warning/10 px-2 py-0.5 text-warning">Word count</span>
                    )}
                    {image.validationFlags?.bannedPhrase && (
                      <span className="rounded-full bg-warning/10 px-2 py-0.5 text-warning">Banned phrase</span>
                    )}
                    {image.validationFlags?.isDuplicateOfProductName && (
                      <span className="rounded-full bg-warning/10 px-2 py-0.5 text-warning">
                        Same as product name
                      </span>
                    )}
                    {image.validationFlags?.isDuplicateWithinProduct && (
                      <span className="rounded-full bg-warning/10 px-2 py-0.5 text-warning">
                        Duplicate within product
                      </span>
                    )}
                    <button
                      onClick={() => handleRegenerate(image.id)}
                      className="rounded-full border border-brand-primary px-2.5 py-0.5 font-medium text-brand-primary transition-colors hover:bg-brand-primary hover:text-white"
                    >
                      Regenerate
                    </button>
                    {image.status === 'failed' && (
                      <button
                        onClick={() => handleRetry(image.id)}
                        className="rounded-full border border-danger px-2.5 py-0.5 font-medium text-danger transition-colors hover:bg-danger hover:text-white"
                      >
                        Retry ({image.error})
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
```

with:

```tsx
            {productImages.map((image) => {
              const isQueued = image.status === 'pending' || image.status === 'processing';
              return (
                <div key={image.id} className="flex gap-4 border-t border-border-light pt-5 first:border-t-0 first:pt-0">
                  <img
                    src={image.imageUrl}
                    alt=""
                    className="h-24 w-24 shrink-0 rounded-md border border-border-light object-cover"
                  />
                  <div className="flex-1">
                    {isQueued ? (
                      <div>
                        <span
                          className={`mb-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[image.status]}`}
                        >
                          {STATUS_LABELS[image.status]}
                        </span>
                        <div className="h-16 w-full animate-pulse rounded-md bg-surface-muted" />
                        <p className="mt-1.5 text-xs text-text-primary/50">
                          {image.status === 'processing' ? 'Generating alt text…' : 'Waiting to process…'}
                        </p>
                      </div>
                    ) : (
                      <>
                        <textarea
                          className="w-full rounded-md border border-border-light p-2.5 text-sm text-text-primary focus:border-brand-accent"
                          defaultValue={image.editedAltText ?? image.generatedAltText ?? ''}
                          onBlur={(e) => handleEdit(image.id, e.target.value)}
                          rows={2}
                        />
                        <input
                          type="text"
                          className="mt-2 w-full rounded-md border border-dashed border-border-light bg-surface-muted p-2 text-xs text-text-primary/80 focus:border-brand-accent"
                          placeholder="Optional correction, e.g. this is a stopwatch, not a mug"
                          value={hints[image.id] ?? ''}
                          onChange={(e) =>
                            setHints((prev) => ({ ...prev, [image.id]: e.target.value }))
                          }
                        />
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                          <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_STYLES[image.status]}`}>
                            {STATUS_LABELS[image.status]}
                          </span>
                          {image.validationFlags && !image.validationFlags.wordCountOk && (
                            <span className="rounded-full bg-warning/10 px-2 py-0.5 text-warning">Word count</span>
                          )}
                          {image.validationFlags?.bannedPhrase && (
                            <span className="rounded-full bg-warning/10 px-2 py-0.5 text-warning">Banned phrase</span>
                          )}
                          {image.validationFlags?.isDuplicateOfProductName && (
                            <span className="rounded-full bg-warning/10 px-2 py-0.5 text-warning">
                              Same as product name
                            </span>
                          )}
                          {image.validationFlags?.isDuplicateWithinProduct && (
                            <span className="rounded-full bg-warning/10 px-2 py-0.5 text-warning">
                              Duplicate within product
                            </span>
                          )}
                          <button
                            onClick={() => handleRegenerate(image.id)}
                            className="rounded-full border border-brand-primary px-2.5 py-0.5 font-medium text-brand-primary transition-colors hover:bg-brand-primary hover:text-white"
                          >
                            Regenerate
                          </button>
                          {image.status === 'failed' && (
                            <button
                              onClick={() => handleRetry(image.id)}
                              className="rounded-full border border-danger px-2.5 py-0.5 font-medium text-danger transition-colors hover:bg-danger hover:text-white"
                            >
                              Retry ({image.error})
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Manual smoke test in the Browser pane**

1. Upload a small CSV and watch the review page while images are still `pending`/`processing`.
2. Confirm those rows show the thumbnail + status pill + pulsing placeholder bar + "Waiting to process…" / "Generating alt text…" text — not an empty editable textarea.
3. Confirm that once an image finishes (`done`), its row switches to the normal editable textarea + hint input + pills, unchanged from today.
4. Confirm `failed` rows still show the Retry button with the error message, unchanged from today.

- [ ] **Step 4: Commit**

```bash
git add src/app/jobs/[id]/review/page.tsx
git commit -m "Review page: placeholder for pending/processing image rows instead of an empty textarea"
```

---

## Full verification (after all 7 tasks)

- [ ] Run the full test suite: `npx vitest run` — expect all tests passing (existing + new).
- [ ] Run `npx tsc --noEmit` — expect no errors.
- [ ] Manual end-to-end smoke test per this project's established practice (see `CLAUDE.md`): upload a real small batch against live Gemini, stop mid-way, resume, let it finish, export the CSV — confirm nothing regressed in the existing retry/regenerate/export flows.
