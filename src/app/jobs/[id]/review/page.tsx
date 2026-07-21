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
  isRunning: boolean;
  stopRequested: boolean;
}

interface ValidationFlags {
  lengthOk: boolean;
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

const STATUS_STYLES: Record<ImageRecord['status'], string> = {
  pending: 'bg-surface-muted text-text-primary/60',
  processing: 'bg-brand-accent/15 text-brand-secondary',
  done: 'bg-brand-accent/15 text-brand-primary',
  failed: 'bg-danger/10 text-danger',
  skipped: 'bg-surface-muted text-text-primary/60',
};

const STATUS_LABELS: Record<ImageRecord['status'], string> = {
  pending: 'Pending',
  processing: 'Processing',
  done: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
};

const JOB_STATUS_LABELS: Record<Job['status'], string> = {
  pending: 'Pending',
  processing: 'Processing',
  complete: 'Complete',
};

export default function ReviewPage({ params }: { params: { id: string } }) {
  const [job, setJob] = useState<Job | null>(null);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [exportError, setExportError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState(false);
  const [hints, setHints] = useState<Record<number, string>>({});
  const [liveLengths, setLiveLengths] = useState<Record<number, number>>({});
  const [expandedImageUrl, setExpandedImageUrl] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
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
        setLiveLengths((prev) => {
          const next = { ...prev };
          for (const image of fetchedImages) {
            const isQueued = image.status === 'pending' || image.status === 'processing';
            if (isQueued && image.id in next) {
              delete next[image.id];
            }
          }
          return next;
        });
      }
      setConnectionError(false);
    } catch {
      // Server unreachable (e.g. a cold-starting Fly machine). The next
      // poll will retry automatically, so just surface a notice.
      setConnectionError(true);
    }
  }, [params.id]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [refresh]);

  async function handleEdit(imageId: number, editedAltText: string) {
    try {
      await fetch(`/api/jobs/${params.id}/images/${imageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ editedAltText }),
      });
    } catch {
      setConnectionError(true);
      return;
    }
    refresh();
  }

  async function handleRetry(imageId: number) {
    const otherPendingCount =
      job && !job.isRunning ? images.filter((i) => i.status === 'pending' && i.id !== imageId).length : 0;
    if (otherPendingCount > 0) {
      const proceed = window.confirm(
        `This will also resume processing ${otherPendingCount} other pending image${otherPendingCount === 1 ? '' : 's'} in this batch. Continue?`
      );
      if (!proceed) return;
    }
    try {
      await fetch(`/api/jobs/${params.id}/images/${imageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retry: true }),
      });
    } catch {
      setConnectionError(true);
      return;
    }
    refresh();
  }

  async function handleRegenerate(imageId: number) {
    const otherPendingCount =
      job && !job.isRunning ? images.filter((i) => i.status === 'pending' && i.id !== imageId).length : 0;
    if (otherPendingCount > 0) {
      const proceed = window.confirm(
        `This will also resume processing ${otherPendingCount} other pending image${otherPendingCount === 1 ? '' : 's'} in this batch. Continue?`
      );
      if (!proceed) return;
    }
    try {
      await fetch(`/api/jobs/${params.id}/images/${imageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regenerate: true, hint: hints[imageId] ?? '' }),
      });
    } catch {
      setConnectionError(true);
      return;
    }
    refresh();
  }

  async function handleStop() {
    try {
      await fetch(`/api/jobs/${params.id}/stop`, { method: 'POST' });
    } catch {
      setConnectionError(true);
      return;
    }
    refresh();
  }

  async function handleResume() {
    try {
      await fetch(`/api/jobs/${params.id}/process`, { method: 'POST' });
    } catch {
      setConnectionError(true);
      return;
    }
    refresh();
  }

  async function handleExport(confirm = false) {
    setExportError(null);
    let response: Response;
    try {
      response = await fetch(`/api/jobs/${params.id}/export${confirm ? '?confirm=true' : ''}`);
    } catch {
      setExportError('Could not reach the server. Check your connection and try again.');
      return;
    }
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

  const resolvedCount = job ? job.doneCount + job.skippedCount : 0;
  const totalImages = images.length;
  const doneSegmentCount = images.filter((i) => i.status === 'done' || i.status === 'skipped').length;
  const failedSegmentCount = images.filter((i) => i.status === 'failed').length;
  const processingSegmentCount = images.filter((i) => i.status === 'processing').length;
  const doneSegmentPct = totalImages > 0 ? (doneSegmentCount / totalImages) * 100 : 0;
  const failedSegmentPct = totalImages > 0 ? (failedSegmentCount / totalImages) * 100 : 0;
  const processingSegmentPct = totalImages > 0 ? (processingSegmentCount / totalImages) * 100 : 0;

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <a
            href="/"
            className="mb-2 inline-block text-sm text-text-primary/60 hover:text-brand-primary hover:underline"
          >
            ← Upload another file
          </a>
          <h1 className="mb-2 font-heading text-2xl font-light tracking-tight text-text-primary">
            Review Alt Text
          </h1>
          {job && (
            <div>
              <div className="flex items-center gap-3">
                <div className="h-1.5 w-40 overflow-hidden rounded-full bg-surface-muted">
                  <div className="flex h-full">
                    <div
                      className="h-full bg-brand-primary transition-all"
                      style={{ width: `${doneSegmentPct}%` }}
                    />
                    <div
                      className="h-full bg-danger transition-all"
                      style={{ width: `${failedSegmentPct}%` }}
                    />
                    <div
                      className="h-full bg-brand-accent/60 transition-all"
                      style={{ width: `${processingSegmentPct}%` }}
                    />
                  </div>
                </div>
                <p className="text-sm text-text-primary/60">
                  {resolvedCount} / {job.imageCount} done
                  {job.failedCount > 0 && `, ${job.failedCount} failed`} · {JOB_STATUS_LABELS[job.status]}
                </p>
              </div>
              <div className="mt-1.5 flex items-center gap-3 text-xs text-text-primary/50">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-sm bg-brand-primary" />
                  Done
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-sm bg-danger" />
                  Failed
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-sm bg-brand-accent/60" />
                  Processing
                </span>
              </div>
            </div>
          )}
          {job && job.status !== 'complete' && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {job.isRunning && !job.stopRequested && (
                <button
                  onClick={handleStop}
                  className="rounded-full border border-danger px-5 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger hover:text-white"
                >
                  Stop Processing
                </button>
              )}
              {job.isRunning && job.stopRequested && (
                <span className="rounded-full bg-surface-muted px-5 py-2 text-sm font-medium text-text-primary/50">
                  Stopping…
                </span>
              )}
              {!job.isRunning && job.stopRequested && (
                <>
                  <span className="rounded-full bg-danger/10 px-5 py-2 text-sm font-medium text-danger">
                    Process Stopped
                  </span>
                  <button
                    onClick={handleResume}
                    className="rounded-full bg-brand-primary px-5 py-2 text-sm font-medium text-white shadow-[0_10px_15px_rgba(30,55,113,0.3)] transition-opacity hover:opacity-90"
                  >
                    Resume
                  </button>
                  <a
                    href="/"
                    className="rounded-full border border-brand-primary px-5 py-2 text-sm font-medium text-brand-primary transition-colors hover:bg-brand-primary hover:text-white"
                  >
                    Start New Batch
                  </a>
                </>
              )}
              {!job.isRunning && !job.stopRequested && (
                <>
                  <span className="rounded-full bg-warning/10 px-5 py-2 text-sm font-medium text-warning">
                    Finished With Errors
                  </span>
                  <button
                    onClick={handleResume}
                    className="rounded-full bg-brand-primary px-5 py-2 text-sm font-medium text-white shadow-[0_10px_15px_rgba(30,55,113,0.3)] transition-opacity hover:opacity-90"
                  >
                    Resume
                  </button>
                  <a
                    href="/"
                    className="rounded-full border border-brand-primary px-5 py-2 text-sm font-medium text-brand-primary transition-colors hover:bg-brand-primary hover:text-white"
                  >
                    Start New Batch
                  </a>
                </>
              )}
            </div>
          )}
        </div>
        <button
          onClick={() => handleExport(false)}
          className="rounded-full bg-brand-primary px-6 py-2.5 text-sm font-medium text-white shadow-[0_10px_15px_rgba(30,55,113,0.3)] transition-opacity hover:opacity-90"
        >
          Export CSV
        </button>
      </div>
      {exportError && <p className="mb-4 text-sm text-danger">{exportError}</p>}
      {connectionError && (
        <p className="mb-4 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
          Couldn&apos;t reach the server. Retrying automatically. If it stays offline, refresh
          the page in a moment (a paused server can take a few seconds to wake up).
        </p>
      )}

      {Object.entries(grouped).map(([sku, productImages]) => (
        <section key={sku} className="mb-6 rounded-lg border border-border-light bg-white p-6 shadow-card">
          <h2 className="mb-4 font-heading text-base font-medium text-text-primary">
            {productImages[0].productName}{' '}
            <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-normal text-text-primary/50">
              {sku}
            </span>
          </h2>
          <div className="space-y-5">
            {productImages.map((image) => {
              const isQueued = image.status === 'pending' || image.status === 'processing';
              const currentLength =
                liveLengths[image.id] ?? (image.editedAltText ?? image.generatedAltText ?? '').length;
              return (
                <div key={image.id} className="flex gap-4 border-t border-border-light pt-5 first:border-t-0 first:pt-0">
                  <img
                    src={image.imageUrl}
                    alt=""
                    className="h-24 w-24 shrink-0 cursor-pointer rounded-md border border-border-light object-cover"
                    onClick={() => setExpandedImageUrl(image.imageUrl)}
                  />
                  <div className="flex-1">
                    {isQueued ? (
                      <div>
                        <span
                          className={`mb-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[image.status]}`}
                        >
                          {STATUS_LABELS[image.status]}
                        </span>
                        <div className="h-16 w-full animate-pulse rounded-md bg-surface-muted" />
                        <p className="mt-1.5 text-xs text-text-primary/50">
                          {image.status === 'processing' ? 'Generating alt text…' : 'Waiting to process…'}
                        </p>
                      </div>
                    ) : (
                      <>
                        <textarea
                          className="w-full rounded-md border border-border-light p-2.5 text-sm text-text-primary focus:border-brand-accent"
                          defaultValue={image.editedAltText ?? image.generatedAltText ?? ''}
                          onChange={(e) =>
                            setLiveLengths((prev) => ({ ...prev, [image.id]: e.target.value.length }))
                          }
                          onBlur={(e) => handleEdit(image.id, e.target.value)}
                          rows={2}
                        />
                        <input
                          type="text"
                          className="mt-2 w-full rounded-md border border-dashed border-border-light bg-surface-muted p-2 text-xs text-text-primary/80 focus:border-brand-accent"
                          placeholder="Optional correction, e.g. this is a stopwatch, not a mug"
                          value={hints[image.id] ?? ''}
                          onChange={(e) =>
                            setHints((prev) => ({ ...prev, [image.id]: e.target.value }))
                          }
                        />
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                          <span
                            className={`rounded-full px-2 py-0.5 font-medium ${
                              currentLength >= 40 && currentLength <= 125
                                ? 'bg-success/10 text-success'
                                : 'bg-danger/10 text-danger'
                            }`}
                          >
                            {currentLength} / 125
                          </span>
                          <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_STYLES[image.status]}`}>
                            {STATUS_LABELS[image.status]}
                          </span>
                          {image.validationFlags?.bannedPhrase && (
                            <span className="rounded-full bg-warning/10 px-2 py-0.5 text-warning">Banned phrase</span>
                          )}
                          {image.validationFlags?.isDuplicateOfProductName && (
                            <span className="rounded-full bg-warning/10 px-2 py-0.5 text-warning">
                              Same as product name
                            </span>
                          )}
                          {image.validationFlags?.isDuplicateWithinProduct && (
                            <span className="rounded-full bg-warning/10 px-2 py-0.5 text-warning">
                              Duplicate within product
                            </span>
                          )}
                          <button
                            onClick={() => handleRegenerate(image.id)}
                            className="rounded-full border border-brand-primary px-2.5 py-0.5 font-medium text-brand-primary transition-colors hover:bg-brand-primary hover:text-white"
                          >
                            Regenerate
                          </button>
                          {image.status === 'failed' && (
                            <button
                              onClick={() => handleRetry(image.id)}
                              className="rounded-full border border-danger px-2.5 py-0.5 font-medium text-danger transition-colors hover:bg-danger hover:text-white"
                            >
                              Retry ({image.error})
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
      {expandedImageUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setExpandedImageUrl(null)}
        >
          <img
            src={expandedImageUrl}
            alt=""
            className="max-h-[85vh] max-w-[85vw] rounded-md object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setExpandedImageUrl(null)}
            className="absolute right-6 top-6 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-xl text-white transition-colors hover:bg-white/20"
            aria-label="Close"
          >
            ×
          </button>
        </div>
      )}
    </main>
  );
}
