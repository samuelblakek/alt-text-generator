import { NextRequest, NextResponse } from 'next/server';
import { parseExportCsv } from '../../../lib/csv/parseExport';
import { jobStore } from '../../../lib/jobs/jobStoreSingleton';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const formData = await request.formData();
  const file = formData.get('file');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file field' }, { status: 400 });
  }

  const csvText = await file.text();
  const rows = parseExportCsv(csvText);

  if (rows.length === 0) {
    return NextResponse.json({ error: 'No images found in the uploaded CSV' }, { status: 400 });
  }

  const job = jobStore.createJob(file.name, rows);
  return NextResponse.json(job, { status: 201 });
}
