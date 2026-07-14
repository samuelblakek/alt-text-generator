import { NextRequest, NextResponse } from 'next/server';
import { jobStore } from '../../../../../lib/jobs/jobStoreSingleton';
import { buildExportCsv } from '../../../../../lib/csv/buildExport';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const job = jobStore.getJob(params.id);
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  const images = jobStore.getImages(params.id);
  const unresolved = images.filter((i) => i.status === 'pending' || i.status === 'failed');
  const confirm = new URL(request.url).searchParams.get('confirm') === 'true';

  if (unresolved.length > 0 && !confirm) {
    return NextResponse.json({ unresolvedCount: unresolved.length }, { status: 409 });
  }

  let csv: string;
  try {
    csv = buildExportCsv(
      images
        .filter((i) => i.status !== 'failed' && i.status !== 'pending')
        .map((i) => ({
          sku: i.sku,
          productName: i.productName,
          imageId: i.imageId,
          imageUrl: i.imageUrl,
          sortOrder: i.sortOrder,
          slotIndex: i.slotIndex,
          finalAltText: i.editedAltText ?? i.generatedAltText ?? '',
        }))
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to build export CSV';
    return NextResponse.json({ error: message }, { status: 422 });
  }

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="alt-text-export-${params.id}.csv"`,
    },
  });
}
