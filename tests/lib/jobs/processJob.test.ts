// tests/lib/jobs/processJob.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDb } from '../../../src/lib/db';
import { createJobStore } from '../../../src/lib/jobs/jobStore';
import { processJob } from '../../../src/lib/jobs/processJob';

vi.mock('../../../src/lib/images/fetchImage', () => ({
  fetchImage: vi.fn().mockResolvedValue({ buffer: Buffer.from([1]), contentType: 'image/jpeg' }),
}));
vi.mock('../../../src/lib/images/downscale', () => ({
  downscaleImage: vi.fn().mockResolvedValue({ buffer: Buffer.from([1]), mimeType: 'image/jpeg' }),
}));
vi.mock('../../../src/lib/gemini/generateAltText', () => ({
  generateAltText: vi.fn().mockResolvedValue('A red widget on a white background shown here'),
}));

describe('processJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('processes all pending images and marks the job complete', async () => {
    const db = createDb(':memory:');
    const store = createJobStore(db);
    const job = store.createJob('test.csv', [
      { sku: 'SKU1', productName: 'Widget', imageId: '1', imageUrl: 'http://a/1.jpg', existingDescription: '', sortOrder: 0, slotIndex: 1 },
    ]);

    await processJob(job.id, { store, geminiClient: {} as any, maxConcurrency: 1 });

    const images = store.getImages(job.id);
    expect(images[0].status).toBe('done');
    expect(images[0].generatedAltText).toBe('A red widget on a white background shown here');
    const updatedJob = store.getJob(job.id);
    expect(updatedJob?.status).toBe('complete');
    expect(updatedJob?.doneCount).toBe(1);
  });

  it('marks an image failed when fetching throws, without stalling the rest of the batch', async () => {
    const { fetchImage } = await import('../../../src/lib/images/fetchImage');
    (fetchImage as any).mockRejectedValueOnce(new Error('404 not found'));

    const db = createDb(':memory:');
    const store = createJobStore(db);
    const job = store.createJob('test.csv', [
      { sku: 'SKU1', productName: 'Widget', imageId: '1', imageUrl: 'http://a/1.jpg', existingDescription: '', sortOrder: 0, slotIndex: 1 },
      { sku: 'SKU1', productName: 'Widget', imageId: '2', imageUrl: 'http://a/2.jpg', existingDescription: '', sortOrder: 1, slotIndex: 2 },
    ]);

    await processJob(job.id, { store, geminiClient: {} as any, maxConcurrency: 2 });

    const images = store.getImages(job.id);
    const failed = images.find((i) => i.imageUrl === 'http://a/1.jpg');
    const done = images.find((i) => i.imageUrl === 'http://a/2.jpg');
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toContain('404');
    expect(done?.status).toBe('done');
    const updatedJob = store.getJob(job.id);
    expect(updatedJob?.failedCount).toBe(1);
    expect(updatedJob?.doneCount).toBe(1);
  });

  it('only reprocesses pending/failed images, leaving done ones untouched (resume semantics)', async () => {
    const { generateAltText } = await import('../../../src/lib/gemini/generateAltText');
    const db = createDb(':memory:');
    const store = createJobStore(db);
    const job = store.createJob('test.csv', [
      { sku: 'SKU1', productName: 'Widget', imageId: '1', imageUrl: 'http://a/1.jpg', existingDescription: '', sortOrder: 0, slotIndex: 1 },
      { sku: 'SKU1', productName: 'Widget', imageId: '2', imageUrl: 'http://a/2.jpg', existingDescription: '', sortOrder: 1, slotIndex: 2 },
    ]);
    const images = store.getImages(job.id);
    store.updateImageStatus(images[0].id, { status: 'done', generatedAltText: 'already done text here' });

    await processJob(job.id, { store, geminiClient: {} as any, maxConcurrency: 2 });

    expect(generateAltText).toHaveBeenCalledTimes(1);
    const updated = store.getImages(job.id);
    expect(updated.find((i) => i.id === images[0].id)?.generatedAltText).toBe('already done text here');
  });
});
