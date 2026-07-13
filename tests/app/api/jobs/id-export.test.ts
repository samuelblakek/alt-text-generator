import { describe, it, expect, vi, beforeEach } from 'vitest';

const doneImage = {
  id: 1,
  sku: 'SKU1',
  productName: 'Widget',
  imageId: '111',
  imageUrl: 'http://a/1.jpg',
  sortOrder: 0,
  slotIndex: 1,
  status: 'done',
  generatedAltText: 'A red widget on a table',
  editedAltText: null,
};
const pendingImage = { ...doneImage, id: 2, slotIndex: 2, status: 'pending', generatedAltText: null };

vi.mock('../../../../src/lib/jobs/jobStoreSingleton', () => ({
  jobStore: { getJob: vi.fn(), getImages: vi.fn() },
}));
vi.mock('../../../../src/lib/csv/buildExport', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/lib/csv/buildExport')>(
    '../../../../src/lib/csv/buildExport'
  );
  return { buildExportCsv: vi.fn(actual.buildExportCsv) };
});

import { GET } from '../../../../src/app/api/jobs/[id]/export/route';
import { jobStore } from '../../../../src/lib/jobs/jobStoreSingleton';
import { buildExportCsv } from '../../../../src/lib/csv/buildExport';

function makeRequest(url: string): Request {
  return new Request(url);
}

describe('GET /api/jobs/:id/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (jobStore.getJob as any).mockReturnValue({ id: 'job-1' });
  });

  it('returns 404 when the job does not exist', async () => {
    (jobStore.getJob as any).mockReturnValue(undefined);
    const response = await GET(makeRequest('http://localhost/api/jobs/missing/export') as any, {
      params: { id: 'missing' },
    });
    expect(response.status).toBe(404);
  });

  it('returns 409 with an unresolved count when images are still pending and confirm is not set', async () => {
    (jobStore.getImages as any).mockReturnValue([doneImage, pendingImage]);
    const response = await GET(makeRequest('http://localhost/api/jobs/job-1/export') as any, {
      params: { id: 'job-1' },
    });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.unresolvedCount).toBe(1);
  });

  it('returns the CSV when confirm=true is set despite unresolved images', async () => {
    (jobStore.getImages as any).mockReturnValue([doneImage, pendingImage]);
    const response = await GET(
      makeRequest('http://localhost/api/jobs/job-1/export?confirm=true') as any,
      { params: { id: 'job-1' } }
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/csv');
    const text = await response.text();
    expect(text).toContain('A red widget on a table');
  });

  it('returns the CSV directly when nothing is unresolved', async () => {
    (jobStore.getImages as any).mockReturnValue([doneImage]);
    const response = await GET(makeRequest('http://localhost/api/jobs/job-1/export') as any, {
      params: { id: 'job-1' },
    });
    expect(response.status).toBe(200);
  });

  it('returns 422 with the error message when buildExportCsv throws (e.g. duplicate image path)', async () => {
    (jobStore.getImages as any).mockReturnValue([doneImage]);
    (buildExportCsv as any).mockImplementationOnce(() => {
      throw new Error('Duplicate image path within product SKU1: /1.jpg');
    });
    const response = await GET(makeRequest('http://localhost/api/jobs/job-1/export') as any, {
      params: { id: 'job-1' },
    });
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).toContain('Duplicate image path within product SKU1');
  });
});
