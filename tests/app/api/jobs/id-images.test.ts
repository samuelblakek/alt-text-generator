import { describe, it, expect, vi, beforeEach } from 'vitest';

const sampleImage = {
  id: 1,
  jobId: 'job-1',
  sku: 'SKU1',
  productName: 'Widget',
  imageId: '111',
  imageUrl: 'http://a/1.jpg',
  existingDescription: '',
  sortOrder: 0,
  slotIndex: 1,
  status: 'done',
  generatedAltText: 'A red widget on a table',
  editedAltText: null,
  validationFlags: null,
  error: null,
};

vi.mock('../../../../src/lib/jobs/jobStoreSingleton', () => ({
  jobStore: {
    getImages: vi.fn(),
    setEditedAltText: vi.fn(),
    recomputeValidationFlagsForSku: vi.fn(),
    updateImageStatus: vi.fn(),
  },
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

import { PATCH } from '../../../../src/app/api/jobs/[id]/images/[imageId]/route';
import { jobStore } from '../../../../src/lib/jobs/jobStoreSingleton';
import { processJob } from '../../../../src/lib/jobs/processJob';
import * as runningJobs from '../../../../src/lib/jobs/runningJobs';

describe('PATCH /api/jobs/:id/images/:imageId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (jobStore.getImages as any).mockReturnValue([sampleImage]);
  });

  it('returns 404 when the image does not belong to the job', async () => {
    (jobStore.getImages as any).mockReturnValue([]);
    const request = new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({}) });
    const response = await PATCH(request as any, { params: { id: 'job-1', imageId: '999' } });
    expect(response.status).toBe(404);
  });

  it('saves an edited alt text and recomputes flags for the product', async () => {
    const request = new Request('http://localhost', {
      method: 'PATCH',
      body: JSON.stringify({ editedAltText: 'A blue widget on a shelf' }),
    });
    await PATCH(request as any, { params: { id: 'job-1', imageId: '1' } });
    expect(jobStore.setEditedAltText).toHaveBeenCalledWith(1, 'A blue widget on a shelf');
    expect(jobStore.recomputeValidationFlagsForSku).toHaveBeenCalledWith('job-1', 'SKU1');
  });

  it('resets status to pending and kicks off reprocessing on retry', async () => {
    (runningJobs.isRunning as any).mockReturnValue(false);
    const request = new Request('http://localhost', {
      method: 'PATCH',
      body: JSON.stringify({ retry: true }),
    });
    await PATCH(request as any, { params: { id: 'job-1', imageId: '1' } });
    expect(jobStore.updateImageStatus).toHaveBeenCalledWith(1, { status: 'pending', error: null });
    expect(processJob).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ store: jobStore, maxConcurrency: 1 })
    );
  });

  it('does not start a second processJob when the job is already running', async () => {
    (runningJobs.isRunning as any).mockReturnValue(true);
    const request = new Request('http://localhost', {
      method: 'PATCH',
      body: JSON.stringify({ retry: true }),
    });
    await PATCH(request as any, { params: { id: 'job-1', imageId: '1' } });
    expect(jobStore.updateImageStatus).toHaveBeenCalledWith(1, { status: 'pending', error: null });
    expect(processJob).not.toHaveBeenCalled();
  });
});
