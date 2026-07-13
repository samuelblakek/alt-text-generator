import { NextRequest, NextResponse } from 'next/server';
import { jobStore } from '../../../../../lib/jobs/jobStoreSingleton';
import { processJob } from '../../../../../lib/jobs/processJob';
import { createGeminiClient } from '../../../../../lib/gemini/client';
import * as runningJobs from '../../../../../lib/jobs/runningJobs';

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
