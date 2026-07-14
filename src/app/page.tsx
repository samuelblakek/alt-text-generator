'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function UploadPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [model, setModel] = useState('gemini-3.5-flash');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setUploading(true);
    setError(null);

    const formData = new FormData();
    formData.set('file', file);
    formData.set('model', model);

    const response = await fetch('/api/jobs', { method: 'POST', body: formData });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? 'Upload failed');
      setUploading(false);
      return;
    }

    const job = await response.json();
    await fetch(`/api/jobs/${job.id}/process`, { method: 'POST' });
    router.push(`/jobs/${job.id}/review`);
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <h1 className="mb-3 font-heading text-3xl font-light tracking-tight text-text-primary">
        Alt Text Generator
      </h1>
      <p className="mb-8 leading-relaxed text-text-primary/70">
        Upload a BigCommerce product image export CSV to generate guideline-compliant alt text.
      </p>

      <form
        onSubmit={handleSubmit}
        className="space-y-6 rounded-lg border border-border-light bg-white p-8 shadow-card"
      >
        <div>
          <span className="mb-2 block text-xs font-medium uppercase tracking-widest text-text-primary/50">
            Export file
          </span>
          <label className="flex cursor-pointer items-center justify-between rounded-md border border-dashed border-border-light bg-surface-muted px-4 py-3 text-sm transition-colors hover:border-brand-accent">
            <span className="truncate text-text-primary/80">
              {file ? file.name : 'Choose a CSV file…'}
            </span>
            <span className="ml-3 shrink-0 font-heading text-xs font-medium text-brand-primary">
              Browse
            </span>
            <input
              type="file"
              accept=".csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="hidden"
            />
          </label>
        </div>

        <label className="block">
          <span className="mb-2 block text-xs font-medium uppercase tracking-widest text-text-primary/50">
            Model
          </span>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="block w-full rounded-md border border-border-light bg-white p-3 text-sm text-text-primary focus:border-brand-accent"
          >
            <option value="gemini-3.5-flash">Latest (fast) — Gemini 3.5 Flash</option>
            <option value="gemini-2.5-pro">Best quality (pro) — Gemini 2.5 Pro</option>
          </select>
        </label>

        <button
          type="submit"
          disabled={!file || uploading}
          className="w-full rounded-full bg-brand-primary px-7 py-3.5 text-sm font-medium text-white shadow-[0_10px_15px_rgba(30,55,113,0.3)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {uploading ? 'Uploading…' : 'Upload & Start Processing'}
        </button>

        {error && <p className="text-sm text-danger">{error}</p>}
      </form>
    </main>
  );
}
