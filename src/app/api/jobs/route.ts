import { NextRequest, NextResponse } from 'next/server';
import { parseExportCsv } from '../../../lib/csv/parseExport';
import { jobStore } from '../../../lib/jobs/jobStoreSingleton';
import { ALLOWED_MODELS, DEFAULT_MODEL } from '../../../lib/gemini/models';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  let file: FormDataEntryValue | null;
  let modelField: FormDataEntryValue | null;
  try {
    const formData = await request.formData();
    file = formData.get('file');
    modelField = formData.get('model');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid form data';
    return NextResponse.json({ error: 'Failed to parse upload: ' + message }, { status: 400 });
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file field' }, { status: 400 });
  }

  const model = ALLOWED_MODELS.includes(modelField as (typeof ALLOWED_MODELS)[number])
    ? (modelField as (typeof ALLOWED_MODELS)[number])
    : DEFAULT_MODEL;

  const csvText = await file.text();

  let rows;
  try {
    rows = parseExportCsv(csvText);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid CSV';
    return NextResponse.json({ error: 'Failed to parse CSV: ' + message }, { status: 400 });
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: 'No images found in the uploaded CSV' }, { status: 400 });
  }

  const job = jobStore.createJob(file.name, rows, model);
  return NextResponse.json(job, { status: 201 });
}
