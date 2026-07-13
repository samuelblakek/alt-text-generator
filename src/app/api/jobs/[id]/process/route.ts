import { NextRequest, NextResponse } from 'next/server';
import { jobStore } from '../../../../../lib/jobs/jobStoreSingleton';
import { processJob } from '../../../../../lib/jobs/processJob';
import { createGeminiClient } from '../../../../../lib/gemini/client';

export const runtime = 'nodejs';

const runningJobs = new Set<string>();

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const job = jobStore.getJob(params.id);
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  if (runningJobs.has(params.id)) {
    return NextResponse.json({ status: 'already_processing' }, { status: 202 });
  }

  runningJobs.add(params.id);
  const geminiClient = createGeminiClient(process.env.GEMINI_API_KEY ?? '');

  processJob(params.id, { store: jobStore, geminiClient })
    .catch((err) => {
      console.error(`Job ${params.id} processing failed:`, err);
    })
    .finally(() => {
      runningJobs.delete(params.id);
    });

  return NextResponse.json({ status: 'started' }, { status: 202 });
}
