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
