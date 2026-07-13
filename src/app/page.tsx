'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function UploadPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setUploading(true);
    setError(null);

    const formData = new FormData();
    formData.set('file', file);

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
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-bold mb-4">Alt Text Generator</h1>
      <p className="mb-6 text-gray-600">
        Upload a BigCommerce product image export CSV to generate guideline-compliant alt text.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="file"
          accept=".csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm"
        />
        <button
          type="submit"
          disabled={!file || uploading}
          className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
        >
          {uploading ? 'Uploading...' : 'Upload & Start Processing'}
        </button>
        {error && <p className="text-red-600">{error}</p>}
      </form>
    </main>
  );
}
