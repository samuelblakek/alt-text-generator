import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../src/lib/jobs/jobStoreSingleton', () => ({
  jobStore: { getJob: vi.fn() },
}));
vi.mock('../../../../src/lib/jobs/processJob', () => ({
  processJob: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../../src/lib/gemini/client', () => ({
  createGeminiClient: vi.fn().mockReturnValue({}),
}));
vi.mock('../../../../src/lib/jobs/runningJobs', () => ({
  isRunning: vi.fn().mockReturnValue(false),
  start: vi.fn(),
  finish: vi.fn(),
}));

import { POST } from '../../../../src/app/api/jobs/[id]/process/route';
import { jobStore } from '../../../../src/lib/jobs/jobStoreSingleton';
import { processJob } from '../../../../src/lib/jobs/processJob';
import * as runningJobs from '../../../../src/lib/jobs/runningJobs';

describe('POST /api/jobs/:id/process', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (runningJobs.isRunning as any).mockReturnValue(false);
  });

  it('returns 404 when the job does not exist', async () => {
    (jobStore.getJob as any).mockReturnValue(undefined);
    const response = await POST({} as any, { params: { id: 'missing' } });
    expect(response.status).toBe(404);
  });

  it('starts processing and returns 202 immediately without awaiting completion', async () => {
    (jobStore.getJob as any).mockReturnValue({ id: 'job-1', status: 'pending' });
    const response = await POST({} as any, { params: { id: 'job-1' } });
    expect(response.status).toBe(202);
    expect(processJob).toHaveBeenCalledWith('job-1', expect.objectContaining({ store: jobStore }));
    expect(runningJobs.start).toHaveBeenCalledWith('job-1');
  });

  it('returns already_processing (202) without starting a second run when the shared guard reports the job is running', async () => {
    (jobStore.getJob as any).mockReturnValue({ id: 'job-1', status: 'processing' });
    (runningJobs.isRunning as any).mockReturnValue(true);
    const response = await POST({} as any, { params: { id: 'job-1' } });
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.status).toBe('already_processing');
    expect(processJob).not.toHaveBeenCalled();
  });
});
