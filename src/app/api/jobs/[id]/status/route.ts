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
