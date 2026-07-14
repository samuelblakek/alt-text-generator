import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../src/lib/jobs/jobStoreSingleton', () => ({
  jobStore: { createJob: vi.fn() },
}));

import { POST } from '../../../../src/app/api/jobs/route';
import { jobStore } from '../../../../src/lib/jobs/jobStoreSingleton';

function makeCsvFile(content: string, name = 'export.csv'): File {
  return new File([content], name, { type: 'text/csv' });
}

describe('POST /api/jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when no file is provided', async () => {
    const formData = new FormData();
    const request = new Request('http://localhost/api/jobs', { method: 'POST', body: formData });
    const response = await POST(request as any);
    expect(response.status).toBe(400);
  });

  it('parses the CSV and creates a job', async () => {
    const csv =
      'Product Code/SKU,Product ID,Product Name,Product Image File - 1,Product Image URL - 1,Product Image ID - 1,Product Image File - 1,Product Image Description - 1,Product Image Sort - 1\n' +
      'SKU1,1,Widget,file.jpg,http://a/1.jpg,111,d/1/file.jpg,Existing desc,0\n';
    (jobStore.createJob as any).mockReturnValue({ id: 'job-1', imageCount: 1 });

    const formData = new FormData();
    formData.set('file', makeCsvFile(csv));
    const request = new Request('http://localhost/api/jobs', { method: 'POST', body: formData });
    const response = await POST(request as any);

    expect(response.status).toBe(201);
    expect(jobStore.createJob).toHaveBeenCalledWith(
      'export.csv',
      expect.arrayContaining([expect.objectContaining({ sku: 'SKU1', imageUrl: 'http://a/1.jpg' })])
    );
  });

  it('returns 400 when the CSV has no images', async () => {
    const csv = 'Product Code/SKU,Product ID,Product Name\nSKU1,1,Widget\n';
    const formData = new FormData();
    formData.set('file', makeCsvFile(csv));
    const request = new Request('http://localhost/api/jobs', { method: 'POST', body: formData });
    const response = await POST(request as any);
    expect(response.status).toBe(400);
  });

  it('returns 400 (not 500) when the CSV is malformed and csv-parse throws', async () => {
    const csv = 'SKU1,1,"Widget\n';
    const formData = new FormData();
    formData.set('file', makeCsvFile(csv));
    const request = new Request('http://localhost/api/jobs', { method: 'POST', body: formData });
    const response = await POST(request as any);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('Failed to parse CSV');
  });
});
