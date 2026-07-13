// tests/lib/jobs/jobStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../../../src/lib/db';
import { createJobStore, type JobStore } from '../../../src/lib/jobs/jobStore';

describe('jobStore', () => {
  let store: JobStore;

  beforeEach(() => {
    const db = createDb(':memory:');
    store = createJobStore(db);
  });

  it('creates a job with image records from parsed rows', () => {
    const job = store.createJob('test.csv', [
      { sku: 'SKU1', productName: 'Widget', imageId: '1', imageUrl: 'http://a/1.jpg', existingDescription: '', sortOrder: 0, slotIndex: 1 },
      { sku: 'SKU1', productName: 'Widget', imageId: '2', imageUrl: 'http://a/2.jpg', existingDescription: '', sortOrder: 1, slotIndex: 2 },
    ]);
    expect(job.imageCount).toBe(2);
    expect(job.status).toBe('pending');

    const images = store.getImages(job.id);
    expect(images).toHaveLength(2);
    expect(images[0].status).toBe('pending');
    expect(images[0].sku).toBe('SKU1');
  });

  it('returns only pending/failed images for reprocessing', () => {
    const job = store.createJob('test.csv', [
      { sku: 'SKU1', productName: 'Widget', imageId: '1', imageUrl: 'http://a/1.jpg', existingDescription: '', sortOrder: 0, slotIndex: 1 },
      { sku: 'SKU1', productName: 'Widget', imageId: '2', imageUrl: 'http://a/2.jpg', existingDescription: '', sortOrder: 1, slotIndex: 2 },
    ]);
    const images = store.getImages(job.id);
    store.updateImageStatus(images[0].id, { status: 'done', generatedAltText: 'text' });

    const pending = store.getPendingOrFailedImages(job.id);
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(images[1].id);
  });

  it('recomputes duplicate-within-product flags after edits', () => {
    const job = store.createJob('test.csv', [
      { sku: 'SKU1', productName: 'Widget', imageId: '1', imageUrl: 'http://a/1.jpg', existingDescription: '', sortOrder: 0, slotIndex: 1 },
      { sku: 'SKU1', productName: 'Widget', imageId: '2', imageUrl: 'http://a/2.jpg', existingDescription: '', sortOrder: 1, slotIndex: 2 },
    ]);
    const images = store.getImages(job.id);
    store.updateImageStatus(images[0].id, { status: 'done', generatedAltText: 'A red widget on a white background' });
    store.updateImageStatus(images[1].id, { status: 'done', generatedAltText: 'A blue widget on a black background' });
    store.recomputeAllValidationFlags(job.id);

    let updated = store.getImages(job.id);
    expect(updated[0].validationFlags?.isDuplicateWithinProduct).toBe(false);

    store.setEditedAltText(images[1].id, 'A red widget on a white background');
    store.recomputeValidationFlagsForSku(job.id, 'SKU1');

    updated = store.getImages(job.id);
    expect(updated[0].validationFlags?.isDuplicateWithinProduct).toBe(true);
    expect(updated[1].validationFlags?.isDuplicateWithinProduct).toBe(true);
  });

  it('recomputes job totals and marks complete when nothing pending', () => {
    const job = store.createJob('test.csv', [
      { sku: 'SKU1', productName: 'Widget', imageId: '1', imageUrl: 'http://a/1.jpg', existingDescription: '', sortOrder: 0, slotIndex: 1 },
    ]);
    const images = store.getImages(job.id);
    store.updateImageStatus(images[0].id, { status: 'done', generatedAltText: 'text' });
    store.recomputeJobTotals(job.id);

    const updatedJob = store.getJob(job.id);
    expect(updatedJob?.status).toBe('complete');
    expect(updatedJob?.doneCount).toBe(1);
  });

  it('leaves the job processing while any image is pending or processing', () => {
    const job = store.createJob('test.csv', [
      { sku: 'SKU1', productName: 'Widget', imageId: '1', imageUrl: 'http://a/1.jpg', existingDescription: '', sortOrder: 0, slotIndex: 1 },
      { sku: 'SKU1', productName: 'Widget', imageId: '2', imageUrl: 'http://a/2.jpg', existingDescription: '', sortOrder: 1, slotIndex: 2 },
    ]);
    const images = store.getImages(job.id);
    store.updateImageStatus(images[0].id, { status: 'done', generatedAltText: 'text' });
    store.recomputeJobTotals(job.id);

    const updatedJob = store.getJob(job.id);
    expect(updatedJob?.status).toBe('processing');
  });

  it('leaves the job processing (not complete) when an image has failed', () => {
    const job = store.createJob('test.csv', [
      { sku: 'SKU1', productName: 'Widget', imageId: '1', imageUrl: 'http://a/1.jpg', existingDescription: '', sortOrder: 0, slotIndex: 1 },
    ]);
    const images = store.getImages(job.id);
    store.updateImageStatus(images[0].id, { status: 'failed', error: 'generation failed' });
    store.recomputeJobTotals(job.id);

    const updatedJob = store.getJob(job.id);
    expect(updatedJob?.status).toBe('processing');
    expect(updatedJob?.failedCount).toBe(1);
  });

  it('resets images stuck in processing (from an interrupted run) back to pending', () => {
    const job = store.createJob('test.csv', [
      { sku: 'SKU1', productName: 'Widget', imageId: '1', imageUrl: 'http://a/1.jpg', existingDescription: '', sortOrder: 0, slotIndex: 1 },
      { sku: 'SKU1', productName: 'Widget', imageId: '2', imageUrl: 'http://a/2.jpg', existingDescription: '', sortOrder: 1, slotIndex: 2 },
    ]);
    const images = store.getImages(job.id);
    store.updateImageStatus(images[0].id, { status: 'processing' });
    store.updateImageStatus(images[1].id, { status: 'done', generatedAltText: 'text' });

    store.resetStaleProcessing(job.id);

    const updated = store.getImages(job.id);
    expect(updated.find((i) => i.id === images[0].id)?.status).toBe('pending');
    expect(updated.find((i) => i.id === images[1].id)?.status).toBe('done');
  });
});
