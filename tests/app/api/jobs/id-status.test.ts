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
