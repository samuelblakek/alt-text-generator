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

  // attemptedIds exists only to stop a permanently-failing image from being retried
  // forever within a single run. It must not block an image a reviewer has reset back
  // to 'pending' mid-run (via Retry/Regenerate) - those are legitimate new attempts, not
  // the same failed attempt looping. So only use attemptedIds to exclude rows still
  // sitting at 'failed'; a row currently 'pending' is always eligible again, regardless
  // of whether its id was seen before.
  const attemptedIds = new Set<number>();
  while (true) {
    // A stopped run leaves not-yet-started candidates sitting at 'pending' untouched
    // (see the per-task check below), so once a stop is requested there is nothing left
    // to make progress on: querying again would just find the same pending rows and,
    // since they're never marked 'failed', spin forever. Stop the outer loop here too.
    if (isStopRequested(jobId)) break;

    const candidates = deps.store
      .getPendingOrFailedImages(jobId)
      .filter((image) => image.status !== 'failed' || !attemptedIds.has(image.id));
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
