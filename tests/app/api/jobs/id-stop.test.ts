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
