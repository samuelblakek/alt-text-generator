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
    // A reviewer's prior edit must not mask freshly regenerated text - clear it so
    // generatedAltText (written by processJob once this reset image is reprocessed)
    // becomes the visible/exported value again.
    jobStore.clearEditedAltText(imageId);

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
