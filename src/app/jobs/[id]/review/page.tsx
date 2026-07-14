// src/app/jobs/[id]/review/page.tsx
'use client';

import { useEffect, useState, useCallback } from 'react';

interface Job {
  id: string;
  status: 'pending' | 'processing' | 'complete';
  imageCount: number;
  doneCount: number;
  failedCount: number;
  skippedCount: number;
}

interface ValidationFlags {
  wordCountOk: boolean;
  bannedPhrase: boolean;
  isDuplicateOfProductName: boolean;
  isDuplicateWithinProduct: boolean;
}

interface ImageRecord {
  id: number;
  sku: string;
  productName: string;
  imageUrl: string;
  status: 'pending' | 'processing' | 'done' | 'failed' | 'skipped';
  generatedAltText: string | null;
  editedAltText: string | null;
  reviewerHint: string | null;
  validationFlags: ValidationFlags | null;
  error: string | null;
}

export default function ReviewPage({ params }: { params: { id: string } }) {
  const [job, setJob] = useState<Job | null>(null);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [exportError, setExportError] = useState<string | null>(null);
  const [hints, setHints] = useState<Record<number, string>>({});

  const refresh = useCallback(async () => {
    const [jobRes, imagesRes] = await Promise.all([
      fetch(`/api/jobs/${params.id}/status`),
      fetch(`/api/jobs/${params.id}/images`),
    ]);
    if (jobRes.ok) setJob(await jobRes.json());
    if (imagesRes.ok) {
      const fetchedImages: ImageRecord[] = await imagesRes.json();
      setImages(fetchedImages);
      setHints((prev) => {
        const next = { ...prev };
        for (const image of fetchedImages) {
          if (!(image.id in next)) {
            next[image.id] = image.reviewerHint ?? '';
          }
        }
        return next;
      });
    }
  }, [params.id]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [refresh]);

  async function handleEdit(imageId: number, editedAltText: string) {
    await fetch(`/api/jobs/${params.id}/images/${imageId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ editedAltText }),
    });
    refresh();
  }

  async function handleRetry(imageId: number) {
    await fetch(`/api/jobs/${params.id}/images/${imageId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retry: true }),
    });
    refresh();
  }

  async function handleRegenerate(imageId: number) {
    await fetch(`/api/jobs/${params.id}/images/${imageId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ regenerate: true, hint: hints[imageId] ?? '' }),
    });
    refresh();
  }

  async function handleExport(confirm = false) {
    setExportError(null);
    const response = await fetch(`/api/jobs/${params.id}/export${confirm ? '?confirm=true' : ''}`);
    if (response.status === 409) {
      const body = await response.json();
      const proceed = window.confirm(
        `${body.unresolvedCount} images are still pending or failed. Export anyway?`
      );
      if (proceed) await handleExport(true);
      return;
    }
    if (!response.ok) {
      setExportError('Export failed');
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `alt-text-export-${params.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const grouped = images.reduce<Record<string, ImageRecord[]>>((acc, image) => {
    (acc[image.sku] ??= []).push(image);
    return acc;
  }, {});

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-bold mb-2">Review Alt Text</h1>
      {job && (
        <p className="mb-6 text-gray-600">
          {job.doneCount + job.skippedCount} / {job.imageCount} done
          {job.failedCount > 0 && `, ${job.failedCount} failed`} — status: {job.status}
        </p>
      )}
      <button
        onClick={() => handleExport(false)}
        className="mb-6 rounded bg-green-600 px-4 py-2 text-white"
      >
        Export CSV
      </button>
      {exportError && <p className="text-red-600">{exportError}</p>}

      {Object.entries(grouped).map(([sku, productImages]) => (
        <section key={sku} className="mb-8 border-t pt-4">
          <h2 className="text-lg font-semibold mb-2">
            {productImages[0].productName} <span className="text-gray-400">({sku})</span>
          </h2>
          <div className="space-y-4">
            {productImages.map((image) => (
              <div key={image.id} className="flex gap-4 items-start">
                <img src={image.imageUrl} alt="" className="h-24 w-24 object-cover border" />
                <div className="flex-1">
                  <textarea
                    className="w-full border p-2 text-sm"
                    defaultValue={image.editedAltText ?? image.generatedAltText ?? ''}
                    onBlur={(e) => handleEdit(image.id, e.target.value)}
                    rows={2}
                  />
                  <input
                    type="text"
                    className="mt-1 w-full border p-1 text-xs"
                    placeholder="Optional correction, e.g. this is a stopwatch, not a mug"
                    value={hints[image.id] ?? ''}
                    onChange={(e) =>
                      setHints((prev) => ({ ...prev, [image.id]: e.target.value }))
                    }
                  />
                  <div className="mt-1 flex gap-2 text-xs">
                    <span className="text-gray-500">status: {image.status}</span>
                    {image.validationFlags && !image.validationFlags.wordCountOk && (
                      <span className="text-amber-600">word count</span>
                    )}
                    {image.validationFlags?.bannedPhrase && (
                      <span className="text-amber-600">banned phrase</span>
                    )}
                    {image.validationFlags?.isDuplicateOfProductName && (
                      <span className="text-amber-600">same as product name</span>
                    )}
                    {image.validationFlags?.isDuplicateWithinProduct && (
                      <span className="text-amber-600">duplicate within product</span>
                    )}
                    <button
                      onClick={() => handleRegenerate(image.id)}
                      className="text-blue-600 underline"
                    >
                      regenerate
                    </button>
                    {image.status === 'failed' && (
                      <button onClick={() => handleRetry(image.id)} className="text-blue-600 underline">
                        retry ({image.error})
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
