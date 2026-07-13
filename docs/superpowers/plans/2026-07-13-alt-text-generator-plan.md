# Alt Text Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Next.js tool that turns a BigCommerce product-image export CSV into guideline-compliant alt text via Google Gemini, with human review, and exports a CSV in the BigCommerce bulk alt-text import app's format.

**Architecture:** Next.js (App Router, TypeScript) app with API routes doing all server-side work (CSV parse, image fetch, Gemini calls, validation) and SQLite (`better-sqlite3`) persisting job/image state so long batches (~2,700 images) survive restarts and resume without re-processing. A single client-rendered review page polls job status and lets a human edit/retry/export.

**Tech Stack:** Next.js 14 (App Router) + TypeScript, `better-sqlite3`, `@google/generative-ai` (`gemini-2.0-flash`), `sharp`, `csv-parse`/`csv-stringify`, `p-limit`, Tailwind CSS, Vitest.

## Global Constraints

- Word count target for generated alt text: 8-12 words (validator flags outside this range as a soft warning, never blocks).
- Banned openers: "image of", "picture of", "photo of" (case-insensitive, checked at string start).
- Gemini model: `gemini-2.0-flash`.
- Env var name: `GEMINI_API_KEY` — must match the convention already used in sibling projects `amazon-content-generator` and `mk-qa-generator`; copy the value across via shell redirect, never paste/print it in chat or code.
- Concurrency env var: `GEMINI_MAX_CONCURRENCY`, default `3`.
- Images are downscaled to a max 1024px longest edge before being sent to Gemini; animated GIFs are sent as a static first frame (PNG).
- Gemini call retry policy: backoff delays `1000ms / 4000ms / 10000ms`, 3 retry attempts before marking `failed`.
- Per-image fetch and generation timeout: 30 seconds each.
- Image fetch requires a browser-like `User-Agent` and `Referer: https://www.menkind.co.uk/` header, follows redirects, and distinguishes HTTP 404 from HTTP 403 as separate failure reasons.
- Output CSV columns: `Name, SKU`, then per image slot `Image N ID, Image N File, Image N Sort Order` carried through unchanged from the source export, with `Image N Description` replaced by the approved alt text. Column width is dynamic — sized to the max image count actually present in the job, never hardcoded to a fixed number of slots.
- Join/matching key for reconciling image records across differently-hosted URLs is the URL **path** (scheme + host stripped), not the full URL string.
- No authentication, single local user, `npm run dev` only — not a hosted service.
- All server-only work (SQLite, Gemini SDK, image fetch/downscale) happens in Next.js Route Handlers with `export const runtime = 'nodejs'` — never in client components.

---

## File Structure

```
alt-text-generator/
  .env.example
  .gitignore
  next.config.js
  package.json
  postcss.config.js
  tailwind.config.ts
  tsconfig.json
  vitest.config.ts
  src/
    app/
      layout.tsx
      page.tsx                                  # upload page
      globals.css
      jobs/[id]/review/page.tsx                  # review UI
      api/jobs/route.ts                          # POST create job
      api/jobs/[id]/status/route.ts              # GET job status
      api/jobs/[id]/images/route.ts              # GET image list
      api/jobs/[id]/images/[imageId]/route.ts    # PATCH edit/retry
      api/jobs/[id]/process/route.ts             # POST start/resume batch
      api/jobs/[id]/export/route.ts              # GET export CSV
    lib/
      db.ts                                      # sqlite connection + schema
      urlMatch.ts                                # URL path normalization
      csv/parseExport.ts                         # wide -> long
      csv/buildExport.ts                         # long -> wide
      validator/validateAltText.ts                # guideline flags
      jobs/jobStore.ts                            # DB CRUD (factory, testable)
      jobs/jobStoreSingleton.ts                    # wired-up singleton for routes
      jobs/retry.ts                                # retry-with-backoff
      jobs/processJob.ts                           # batch orchestration
      images/fetchImage.ts                         # HTTP fetch w/ headers
      images/downscale.ts                          # sharp resize
      gemini/systemPrompt.ts                       # guideline system prompt
      gemini/client.ts                             # Gemini client factory
      gemini/generateAltText.ts                    # single-image generation call
  tests/
    lib/csv/parseExport.test.ts
    lib/csv/buildExport.test.ts
    lib/urlMatch.test.ts
    lib/validator/validateAltText.test.ts
    lib/jobs/jobStore.test.ts
    lib/jobs/retry.test.ts
    lib/jobs/processJob.test.ts
    lib/images/fetchImage.test.ts
    lib/images/downscale.test.ts
    lib/gemini/generateAltText.test.ts
    app/api/jobs/route.test.ts
    app/api/jobs/id-process.test.ts
    app/api/jobs/id-images.test.ts
    app/api/jobs/id-export.test.ts
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.js`, `tailwind.config.ts`, `postcss.config.js`, `vitest.config.ts`, `.gitignore`, `.env.example`, `.env` (untracked)
- Create: `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx` (placeholder, replaced in Task 16)

**Interfaces:**
- Produces: a runnable `npm run dev` Next.js app and a working `npm test` command that later tasks add tests to.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "alt-text-generator",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "next": "^14.2.5",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "better-sqlite3": "^11.1.2",
    "@google/generative-ai": "^0.21.0",
    "sharp": "^0.33.4",
    "csv-parse": "^5.5.6",
    "csv-stringify": "^6.5.0",
    "p-limit": "^5.0.0"
  },
  "devDependencies": {
    "typescript": "^5.5.4",
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@types/better-sqlite3": "^7.6.11",
    "tailwindcss": "^3.4.7",
    "postcss": "^8.4.40",
    "autoprefixer": "^10.4.19",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Write `next.config.js`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3', 'sharp'],
  },
};

module.exports = nextConfig;
```

- [ ] **Step 4: Write `tailwind.config.ts` and `postcss.config.js`**

```ts
// tailwind.config.ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};

export default config;
```

```js
// postcss.config.js
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 5: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 6: Write `.gitignore` and `.env.example`**

```
node_modules/
.next/
data/
.env
```

```
GEMINI_API_KEY=
GEMINI_MAX_CONCURRENCY=3
```

- [ ] **Step 7: Create placeholder app shell**

```tsx
// src/app/layout.tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Alt Text Generator',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

```css
/* src/app/globals.css */
@tailwind base;
@tailwind components;
@tailwind utilities;
```

```tsx
// src/app/page.tsx
export default function UploadPage() {
  return <main className="p-8">Alt Text Generator — coming soon</main>;
}
```

- [ ] **Step 8: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, no errors.

- [ ] **Step 9: Copy the Gemini API key from a sibling project without displaying it**

Run:
```bash
grep "^GEMINI_API_KEY=" "/c/Users/samuel/Documents/claude-code/amazon-content-generator/.env" > .env
echo "GEMINI_MAX_CONCURRENCY=3" >> .env
```
Expected: `.env` created with two lines; the command output prints nothing to the terminal (redirected straight to the file), so the key value is never displayed.

- [ ] **Step 10: Verify the app boots**

Run: `npm run dev` (then stop it once the "Ready" message appears, e.g. with Ctrl+C)
Expected: server starts on `http://localhost:3000` with no errors; visiting it shows the placeholder page.

- [ ] **Step 11: Commit**

```bash
git add package.json tsconfig.json next.config.js tailwind.config.ts postcss.config.js vitest.config.ts .gitignore .env.example src/app
git commit -m "Scaffold Next.js app with TypeScript, Tailwind, and Vitest"
```

---

### Task 2: Shared Types

**Files:**
- Create: `src/types/index.ts`

**Interfaces:**
- Produces: `JobStatus`, `ImageStatus`, `Job`, `ValidationFlags`, `ImageRecord` — the canonical shapes every later task imports.

- [ ] **Step 1: Write the types file**

```ts
// src/types/index.ts
export type JobStatus = 'pending' | 'processing' | 'complete';
export type ImageStatus = 'pending' | 'processing' | 'done' | 'failed' | 'skipped';

export interface Job {
  id: string;
  createdAt: string;
  sourceFilename: string;
  status: JobStatus;
  imageCount: number;
  doneCount: number;
  failedCount: number;
  skippedCount: number;
}

export interface ValidationFlags {
  wordCountOk: boolean;
  bannedPhrase: boolean;
  isDuplicateOfProductName: boolean;
  isDuplicateWithinProduct: boolean;
}

export interface ImageRecord {
  id: number;
  jobId: string;
  sku: string;
  productName: string;
  imageId: string;
  imageUrl: string;
  existingDescription: string;
  sortOrder: number;
  slotIndex: number;
  status: ImageStatus;
  generatedAltText: string | null;
  editedAltText: string | null;
  validationFlags: ValidationFlags | null;
  error: string | null;
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "Add shared domain types"
```

---

### Task 3: SQLite Connection and Schema

**Files:**
- Create: `src/lib/db.ts`

**Interfaces:**
- Produces: `createDb(dbPath: string): Database.Database` (factory, used directly by tests with `:memory:`), and `db: Database.Database` (the app's real singleton connection at `data/alt-text-generator.db`).

- [ ] **Step 1: Write `src/lib/db.ts`**

```ts
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  source_filename TEXT NOT NULL,
  status TEXT NOT NULL,
  image_count INTEGER NOT NULL DEFAULT 0,
  done_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS image_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  image_id TEXT NOT NULL,
  image_url TEXT NOT NULL,
  existing_description TEXT,
  sort_order INTEGER NOT NULL,
  slot_index INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  generated_alt_text TEXT,
  edited_alt_text TEXT,
  validation_flags TEXT,
  error TEXT,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_image_records_job_id ON image_records(job_id);
`;

export function createDb(dbPath: string): Database.Database {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}

const DEFAULT_DB_PATH = path.join(process.cwd(), 'data', 'alt-text-generator.db');

export const db = createDb(DEFAULT_DB_PATH);
```

- [ ] **Step 2: Verify it type-checks and the schema applies**

Run: `npx tsc --noEmit`
Expected: no errors.

Run (from project root, one-off sanity check):
```bash
node -e "const {createDb} = require('./src/lib/db.ts')" 2>&1 || echo "expected: ts-node not configured, skip runtime check here — covered by Task 8's jobStore tests instead"
```
Expected: this is just a note that `db.ts` has no dedicated test file — its behavior is exercised end-to-end by Task 8's `jobStore.test.ts`, which calls `createDb(':memory:')` directly.

- [ ] **Step 3: Commit**

```bash
git add src/lib/db.ts
git commit -m "Add SQLite connection and schema"
```

---

### Task 4: URL Path Matching Utility

**Files:**
- Create: `src/lib/urlMatch.ts`
- Test: `tests/lib/urlMatch.test.ts`

**Interfaces:**
- Produces: `normalizeUrlPath(url: string): string`, `urlPathsMatch(a: string, b: string): boolean` — used by Task 6's export builder for a duplicate-path sanity check.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/urlMatch.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeUrlPath, urlPathsMatch } from '../../src/lib/urlMatch';

describe('normalizeUrlPath', () => {
  it('strips scheme and host, keeping only the path', () => {
    const url = 'http://www.menkind.co.uk/product_images/i/924/126105_100x100__64969.jpg';
    expect(normalizeUrlPath(url)).toBe('/product_images/i/924/126105_100x100__64969.jpg');
  });

  it('returns the same path regardless of scheme or host', () => {
    const a = 'http://www.menkind.co.uk/product_images/i/924/126105_100x100__64969.jpg';
    const b = 'https://store-1cfhlpd74o.mybigcommerce.com/product_images/i/924/126105_100x100__64969.jpg';
    expect(normalizeUrlPath(a)).toBe(normalizeUrlPath(b));
  });

  it('returns the raw string unchanged if it is not a valid URL', () => {
    expect(normalizeUrlPath('not-a-url')).toBe('not-a-url');
  });
});

describe('urlPathsMatch', () => {
  it('returns true for URLs sharing a path across different hosts', () => {
    const a = 'http://www.menkind.co.uk/product_images/i/924/file.jpg';
    const b = 'https://store-1cfhlpd74o.mybigcommerce.com/product_images/i/924/file.jpg';
    expect(urlPathsMatch(a, b)).toBe(true);
  });

  it('returns false for genuinely different paths', () => {
    const a = 'http://www.menkind.co.uk/product_images/i/924/file.jpg';
    const b = 'http://www.menkind.co.uk/product_images/x/000/other.jpg';
    expect(urlPathsMatch(a, b)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/urlMatch.test.ts`
Expected: FAIL with "Cannot find module '../../src/lib/urlMatch'"

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/urlMatch.ts
export function normalizeUrlPath(url: string): string {
  try {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.pathname);
  } catch {
    return url;
  }
}

export function urlPathsMatch(a: string, b: string): boolean {
  return normalizeUrlPath(a) === normalizeUrlPath(b);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/urlMatch.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/urlMatch.ts tests/lib/urlMatch.test.ts
git commit -m "Add URL path normalization/matching utility"
```

---

### Task 5: CSV Export Parsing (wide -> long)

**Files:**
- Create: `src/lib/csv/parseExport.ts`
- Test: `tests/lib/csv/parseExport.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ParsedImageRow { sku, productName, imageId, imageUrl, existingDescription, sortOrder, slotIndex }` and `parseExportCsv(csvText: string): ParsedImageRow[]` — consumed by Task 8's `jobStore.createJob` and Task 14's upload route.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/csv/parseExport.test.ts
import { describe, it, expect } from 'vitest';
import { parseExportCsv } from '../../../src/lib/csv/parseExport';

function makeSlot(url: string, id: string, description: string, sort: number): string {
  return `file.jpg,${url},${id},d/1/file.jpg,${description},${sort}`;
}

describe('parseExportCsv', () => {
  it('flattens a product with two image slots into two rows', () => {
    const header = 'Product Code/SKU,Product ID,Product Name,' +
      'Product Image File - 1,Product Image URL - 1,Product Image ID - 1,Product Image File - 1,Product Image Description - 1,Product Image Sort - 1,' +
      'Product Image File - 2,Product Image URL - 2,Product Image ID - 2,Product Image File - 2,Product Image Description - 2,Product Image Sort - 2';
    const row = `SKU1,1,Widget,${makeSlot('http://a/1.jpg', '111', 'Widget', 0)},${makeSlot('http://a/2.jpg', '112', 'Widget side', 1)}`;
    const rows = parseExportCsv(`${header}\n${row}\n`);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      sku: 'SKU1',
      productName: 'Widget',
      imageId: '111',
      imageUrl: 'http://a/1.jpg',
      existingDescription: 'Widget',
      sortOrder: 0,
      slotIndex: 1,
    });
    expect(rows[1].slotIndex).toBe(2);
    expect(rows[1].imageUrl).toBe('http://a/2.jpg');
  });

  it('skips slots with no URL', () => {
    const header = 'Product Code/SKU,Product ID,Product Name,' +
      'Product Image File - 1,Product Image URL - 1,Product Image ID - 1,Product Image File - 1,Product Image Description - 1,Product Image Sort - 1,' +
      'Product Image File - 2,Product Image URL - 2,Product Image ID - 2,Product Image File - 2,Product Image Description - 2,Product Image Sort - 2';
    const row = `SKU1,1,Widget,${makeSlot('http://a/1.jpg', '111', 'Widget', 0)},,,,,,`;
    const rows = parseExportCsv(`${header}\n${row}\n`);
    expect(rows).toHaveLength(1);
  });

  it('handles a product with more than 13 image slots', () => {
    const slotCount = 15;
    const headerSlots = Array.from({ length: slotCount }, (_, i) =>
      `Product Image File - ${i + 1},Product Image URL - ${i + 1},Product Image ID - ${i + 1},Product Image File - ${i + 1},Product Image Description - ${i + 1},Product Image Sort - ${i + 1}`
    ).join(',');
    const header = `Product Code/SKU,Product ID,Product Name,${headerSlots}`;
    const dataSlots = Array.from({ length: slotCount }, (_, i) =>
      makeSlot(`http://a/${i + 1}.jpg`, `${100 + i}`, 'Widget', i)
    ).join(',');
    const row = `SKU1,1,Widget,${dataSlots}`;
    const rows = parseExportCsv(`${header}\n${row}\n`);
    expect(rows).toHaveLength(15);
    expect(rows[14].slotIndex).toBe(15);
    expect(rows[14].imageUrl).toBe('http://a/15.jpg');
  });

  it('skips rows with no SKU or product name', () => {
    const header = 'Product Code/SKU,Product ID,Product Name';
    const rows = parseExportCsv(`${header}\n,,\n`);
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/csv/parseExport.test.ts`
Expected: FAIL with "Cannot find module '../../../src/lib/csv/parseExport'"

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/csv/parseExport.ts
import { parse } from 'csv-parse/sync';

export interface ParsedImageRow {
  sku: string;
  productName: string;
  imageId: string;
  imageUrl: string;
  existingDescription: string;
  sortOrder: number;
  slotIndex: number;
}

const COLUMNS_PER_SLOT = 6;
const LEADING_COLUMNS = 3; // SKU, Product ID, Product Name

export function parseExportCsv(csvText: string): ParsedImageRow[] {
  const rows: string[][] = parse(csvText, { skip_empty_lines: true });
  const [, ...dataRows] = rows; // drop header row
  const results: ParsedImageRow[] = [];

  for (const row of dataRows) {
    const sku = row[0]?.trim();
    const productName = row[2]?.trim();
    if (!sku || !productName) continue;

    const slotCount = Math.floor((row.length - LEADING_COLUMNS) / COLUMNS_PER_SLOT);
    for (let slot = 0; slot < slotCount; slot++) {
      const base = LEADING_COLUMNS + slot * COLUMNS_PER_SLOT;
      const imageUrl = row[base + 1]?.trim();
      if (!imageUrl) continue;
      const imageId = row[base + 2]?.trim() ?? '';
      const existingDescription = row[base + 4]?.trim() ?? '';
      const sortOrderRaw = row[base + 5]?.trim();
      const sortOrder =
        sortOrderRaw && !Number.isNaN(Number(sortOrderRaw)) ? Number(sortOrderRaw) : slot;

      results.push({
        sku,
        productName,
        imageId,
        imageUrl,
        existingDescription,
        sortOrder,
        slotIndex: slot + 1,
      });
    }
  }

  return results;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/csv/parseExport.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/csv/parseExport.ts tests/lib/csv/parseExport.test.ts
git commit -m "Add wide-to-long export CSV parser"
```

---

### Task 6: CSV Export Building (long -> wide)

**Files:**
- Create: `src/lib/csv/buildExport.ts`
- Test: `tests/lib/csv/buildExport.test.ts`

**Interfaces:**
- Consumes: `normalizeUrlPath` from Task 4 (`src/lib/urlMatch.ts`).
- Produces: `ExportImageInput { sku, productName, imageId, imageUrl, sortOrder, slotIndex, finalAltText }` and `buildExportCsv(images: ExportImageInput[]): string` — consumed by Task 15's export route.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/csv/buildExport.test.ts
import { describe, it, expect } from 'vitest';
import { buildExportCsv, type ExportImageInput } from '../../../src/lib/csv/buildExport';

function image(overrides: Partial<ExportImageInput>): ExportImageInput {
  return {
    sku: 'SKU1',
    productName: 'Widget',
    imageId: '111',
    imageUrl: 'http://a/1.jpg',
    sortOrder: 0,
    slotIndex: 1,
    finalAltText: 'A red widget on a white background',
    ...overrides,
  };
}

describe('buildExportCsv', () => {
  it('builds a header and row for a single-image product', () => {
    const csv = buildExportCsv([image({})]);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('Name,SKU,Image 1 ID,Image 1 File,Image 1 Description,Image 1 Sort Order');
    expect(lines[1]).toBe('Widget,SKU1,111,http://a/1.jpg,A red widget on a white background,0');
  });

  it('sizes the header to the max slot count across all products, not a fixed 13', () => {
    const images: ExportImageInput[] = Array.from({ length: 17 }, (_, i) =>
      image({ imageId: `${i}`, imageUrl: `http://a/${i}.jpg`, slotIndex: i + 1, sortOrder: i })
    );
    const csv = buildExportCsv(images);
    const header = csv.trim().split('\n')[0].split(',');
    expect(header).toHaveLength(2 + 17 * 4);
    expect(header[header.length - 4]).toBe('Image 17 ID');
  });

  it('pads shorter products with empty trailing cells up to the shared max width', () => {
    const images: ExportImageInput[] = [
      image({ sku: 'SKU1', slotIndex: 1 }),
      image({ sku: 'SKU2', slotIndex: 1 }),
      image({ sku: 'SKU2', slotIndex: 2, imageId: '222', imageUrl: 'http://a/2.jpg' }),
    ];
    const csv = buildExportCsv(images);
    const lines = csv.trim().split('\n');
    const sku1Row = lines.find((l) => l.includes('SKU1'))!.split(',');
    expect(sku1Row).toHaveLength(2 + 2 * 4);
    expect(sku1Row[sku1Row.length - 1]).toBe('');
  });

  it('throws if two images in the same product normalize to the same URL path', () => {
    const images: ExportImageInput[] = [
      image({ imageUrl: 'http://a/dup.jpg', slotIndex: 1 }),
      image({ imageUrl: 'https://b.example.com/dup.jpg', slotIndex: 2 }),
    ];
    expect(() => buildExportCsv(images)).toThrow(/Duplicate image path/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/csv/buildExport.test.ts`
Expected: FAIL with "Cannot find module '../../../src/lib/csv/buildExport'"

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/csv/buildExport.ts
import { stringify } from 'csv-stringify/sync';
import { normalizeUrlPath } from '../urlMatch';

export interface ExportImageInput {
  sku: string;
  productName: string;
  imageId: string;
  imageUrl: string;
  sortOrder: number;
  slotIndex: number;
  finalAltText: string;
}

export function buildExportCsv(images: ExportImageInput[]): string {
  const bySku = new Map<string, ExportImageInput[]>();
  for (const image of images) {
    const list = bySku.get(image.sku) ?? [];
    list.push(image);
    bySku.set(image.sku, list);
  }

  let maxSlots = 0;
  for (const list of bySku.values()) {
    maxSlots = Math.max(maxSlots, list.length);
  }

  const header = ['Name', 'SKU'];
  for (let n = 1; n <= maxSlots; n++) {
    header.push(`Image ${n} ID`, `Image ${n} File`, `Image ${n} Description`, `Image ${n} Sort Order`);
  }

  const rows: (string | number)[][] = [];
  for (const [sku, list] of bySku) {
    const seenPaths = new Set<string>();
    for (const image of list) {
      const imagePath = normalizeUrlPath(image.imageUrl);
      if (seenPaths.has(imagePath)) {
        throw new Error(`Duplicate image path within product ${sku}: ${imagePath}`);
      }
      seenPaths.add(imagePath);
    }

    const sorted = [...list].sort((a, b) => a.slotIndex - b.slotIndex);
    const row: (string | number)[] = [sorted[0].productName, sku];
    for (const image of sorted) {
      row.push(image.imageId, image.imageUrl, image.finalAltText, image.sortOrder);
    }
    while (row.length < 2 + maxSlots * 4) {
      row.push('');
    }
    rows.push(row);
  }

  return stringify([header, ...rows]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/csv/buildExport.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/csv/buildExport.ts tests/lib/csv/buildExport.test.ts
git commit -m "Add long-to-wide export CSV builder with dynamic slot width"
```

---

### Task 7: Alt Text Validator

**Files:**
- Create: `src/lib/validator/validateAltText.ts`
- Test: `tests/lib/validator/validateAltText.test.ts`

**Interfaces:**
- Produces: `AltTextFlags { wordCountOk, bannedPhrase, isDuplicateOfProductName }`, `validateAltText(altText: string, productName: string): AltTextFlags`, and `computeDuplicateWithinProduct(altTexts: { id: number; text: string }[]): Map<number, boolean>` — both consumed by Task 8's `jobStore.recomputeValidationFlagsForSku`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/validator/validateAltText.test.ts
import { describe, it, expect } from 'vitest';
import { validateAltText, computeDuplicateWithinProduct } from '../../../src/lib/validator/validateAltText';

describe('validateAltText', () => {
  it('flags word count outside the 8-12 range', () => {
    expect(validateAltText('A red widget', 'Widget').wordCountOk).toBe(false);
    expect(
      validateAltText('A bright red plastic widget standing upright on a plain white table', 'Widget')
        .wordCountOk
    ).toBe(true);
  });

  it('flags banned openers case-insensitively', () => {
    expect(validateAltText('Image of a red widget on a table surface', 'Widget').bannedPhrase).toBe(true);
    expect(validateAltText('picture of a red widget on a table surface', 'Widget').bannedPhrase).toBe(true);
    expect(validateAltText('A red widget standing on a wooden table surface', 'Widget').bannedPhrase).toBe(
      false
    );
  });

  it('flags alt text that is just the bare product name', () => {
    expect(validateAltText('Widget', 'Widget').isDuplicateOfProductName).toBe(true);
    expect(validateAltText('  widget  ', 'Widget').isDuplicateOfProductName).toBe(true);
    expect(validateAltText('A red widget on a table', 'Widget').isDuplicateOfProductName).toBe(false);
  });
});

describe('computeDuplicateWithinProduct', () => {
  it('flags entries that share identical text (case/whitespace insensitive)', () => {
    const result = computeDuplicateWithinProduct([
      { id: 1, text: 'A red widget on a table' },
      { id: 2, text: '  a red widget on a table  ' },
      { id: 3, text: 'A red widget from the side' },
    ]);
    expect(result.get(1)).toBe(true);
    expect(result.get(2)).toBe(true);
    expect(result.get(3)).toBe(false);
  });

  it('does not flag empty strings as duplicates of each other', () => {
    const result = computeDuplicateWithinProduct([
      { id: 1, text: '' },
      { id: 2, text: '' },
    ]);
    expect(result.get(1)).toBe(false);
    expect(result.get(2)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/validator/validateAltText.test.ts`
Expected: FAIL with "Cannot find module '../../../src/lib/validator/validateAltText'"

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/validator/validateAltText.ts
export interface AltTextFlags {
  wordCountOk: boolean;
  bannedPhrase: boolean;
  isDuplicateOfProductName: boolean;
}

const BANNED_OPENERS = [/^image of\b/i, /^picture of\b/i, /^photo of\b/i];

export function validateAltText(altText: string, productName: string): AltTextFlags {
  const trimmed = altText.trim();
  const wordCount = trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
  return {
    wordCountOk: wordCount >= 8 && wordCount <= 12,
    bannedPhrase: BANNED_OPENERS.some((re) => re.test(trimmed)),
    isDuplicateOfProductName: trimmed.toLowerCase() === productName.trim().toLowerCase(),
  };
}

export function computeDuplicateWithinProduct(
  altTexts: { id: number; text: string }[]
): Map<number, boolean> {
  const counts = new Map<string, number>();
  for (const { text } of altTexts) {
    const key = text.trim().toLowerCase();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const result = new Map<number, boolean>();
  for (const { id, text } of altTexts) {
    const key = text.trim().toLowerCase();
    result.set(id, key.length > 0 && (counts.get(key) ?? 0) > 1);
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/validator/validateAltText.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/validator/validateAltText.ts tests/lib/validator/validateAltText.test.ts
git commit -m "Add alt text guideline validator"
```

---

### Task 8: Job Store (DB CRUD + validation flag recompute)

**Files:**
- Create: `src/lib/jobs/jobStore.ts`
- Create: `src/lib/jobs/jobStoreSingleton.ts`
- Test: `tests/lib/jobs/jobStore.test.ts`

**Interfaces:**
- Consumes: `createDb` (Task 3), `ParsedImageRow` (Task 5), `validateAltText`/`computeDuplicateWithinProduct` (Task 7), `Job`/`ImageRecord`/`ValidationFlags`/`JobStatus`/`ImageStatus` (Task 2).
- Produces: `createJobStore(db: Database.Database)` returning `{ createJob, getJob, getImages, getPendingOrFailedImages, updateImageStatus, setEditedAltText, recomputeValidationFlagsForSku, recomputeAllValidationFlags, recomputeJobTotals }`, type `JobStore = ReturnType<typeof createJobStore>`, and the wired-up singleton `jobStore` in `jobStoreSingleton.ts`. Consumed by Task 13 (`processJob`) and Tasks 14-15 (API routes).

- [ ] **Step 1: Write the failing test**

```ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/jobs/jobStore.test.ts`
Expected: FAIL with "Cannot find module '../../../src/lib/jobs/jobStore'"

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/jobs/jobStore.ts
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { ParsedImageRow } from '../csv/parseExport';
import { validateAltText, computeDuplicateWithinProduct } from '../validator/validateAltText';
import type { Job, ImageRecord, ValidationFlags, JobStatus, ImageStatus } from '../../types';

interface ImageRow {
  id: number;
  job_id: string;
  sku: string;
  product_name: string;
  image_id: string;
  image_url: string;
  existing_description: string | null;
  sort_order: number;
  slot_index: number;
  status: ImageStatus;
  generated_alt_text: string | null;
  edited_alt_text: string | null;
  validation_flags: string | null;
  error: string | null;
}

interface JobRow {
  id: string;
  created_at: string;
  source_filename: string;
  status: JobStatus;
  image_count: number;
  done_count: number;
  failed_count: number;
  skipped_count: number;
}

function rowToImageRecord(row: ImageRow): ImageRecord {
  return {
    id: row.id,
    jobId: row.job_id,
    sku: row.sku,
    productName: row.product_name,
    imageId: row.image_id,
    imageUrl: row.image_url,
    existingDescription: row.existing_description ?? '',
    sortOrder: row.sort_order,
    slotIndex: row.slot_index,
    status: row.status,
    generatedAltText: row.generated_alt_text,
    editedAltText: row.edited_alt_text,
    validationFlags: row.validation_flags ? JSON.parse(row.validation_flags) : null,
    error: row.error,
  };
}

function rowToJob(row: JobRow): Job {
  return {
    id: row.id,
    createdAt: row.created_at,
    sourceFilename: row.source_filename,
    status: row.status,
    imageCount: row.image_count,
    doneCount: row.done_count,
    failedCount: row.failed_count,
    skippedCount: row.skipped_count,
  };
}

export function createJobStore(db: Database.Database) {
  function createJob(sourceFilename: string, rows: ParsedImageRow[]): Job {
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    const insertJob = db.prepare(
      `INSERT INTO jobs (id, created_at, source_filename, status, image_count, done_count, failed_count, skipped_count)
       VALUES (?, ?, ?, 'pending', ?, 0, 0, 0)`
    );
    const insertImage = db.prepare(
      `INSERT INTO image_records
         (job_id, sku, product_name, image_id, image_url, existing_description, sort_order, slot_index, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    );

    const tx = db.transaction(() => {
      insertJob.run(id, createdAt, sourceFilename, rows.length);
      for (const row of rows) {
        insertImage.run(
          id,
          row.sku,
          row.productName,
          row.imageId,
          row.imageUrl,
          row.existingDescription,
          row.sortOrder,
          row.slotIndex
        );
      }
    });
    tx();

    return getJob(id) as Job;
  }

  function getJob(jobId: string): Job | undefined {
    const row = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(jobId) as JobRow | undefined;
    return row ? rowToJob(row) : undefined;
  }

  function getImages(jobId: string): ImageRecord[] {
    const rows = db
      .prepare(`SELECT * FROM image_records WHERE job_id = ? ORDER BY sku, slot_index`)
      .all(jobId) as ImageRow[];
    return rows.map(rowToImageRecord);
  }

  function getPendingOrFailedImages(jobId: string): ImageRecord[] {
    const rows = db
      .prepare(
        `SELECT * FROM image_records WHERE job_id = ? AND status IN ('pending', 'failed') ORDER BY sku, slot_index`
      )
      .all(jobId) as ImageRow[];
    return rows.map(rowToImageRecord);
  }

  function updateImageStatus(
    id: number,
    patch: { status: ImageStatus; generatedAltText?: string | null; error?: string | null }
  ): void {
    db.prepare(
      `UPDATE image_records SET status = ?, generated_alt_text = COALESCE(?, generated_alt_text), error = ?
       WHERE id = ?`
    ).run(patch.status, patch.generatedAltText ?? null, patch.error ?? null, id);
  }

  function setEditedAltText(id: number, editedAltText: string): void {
    db.prepare(`UPDATE image_records SET edited_alt_text = ? WHERE id = ?`).run(editedAltText, id);
  }

  function setValidationFlags(id: number, flags: ValidationFlags): void {
    db.prepare(`UPDATE image_records SET validation_flags = ? WHERE id = ?`).run(
      JSON.stringify(flags),
      id
    );
  }

  function recomputeValidationFlagsForSku(jobId: string, sku: string): void {
    const rows = db
      .prepare(`SELECT * FROM image_records WHERE job_id = ? AND sku = ?`)
      .all(jobId, sku) as ImageRow[];
    const records = rows.map(rowToImageRecord);

    const finalTexts = records.map((r) => ({
      id: r.id,
      text: r.editedAltText ?? r.generatedAltText ?? '',
    }));
    const duplicateMap = computeDuplicateWithinProduct(finalTexts);

    for (const record of records) {
      const finalText = record.editedAltText ?? record.generatedAltText ?? '';
      const base = validateAltText(finalText, record.productName);
      const flags: ValidationFlags = {
        ...base,
        isDuplicateWithinProduct: duplicateMap.get(record.id) ?? false,
      };
      setValidationFlags(record.id, flags);
    }
  }

  function recomputeAllValidationFlags(jobId: string): void {
    const skus = db
      .prepare(`SELECT DISTINCT sku FROM image_records WHERE job_id = ?`)
      .all(jobId) as { sku: string }[];
    for (const { sku } of skus) {
      recomputeValidationFlagsForSku(jobId, sku);
    }
  }

  function recomputeJobTotals(jobId: string): void {
    const counts = db
      .prepare(
        `SELECT
           SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
           SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skipped,
           SUM(CASE WHEN status IN ('pending', 'processing') THEN 1 ELSE 0 END) as remaining
         FROM image_records WHERE job_id = ?`
      )
      .get(jobId) as { done: number; failed: number; skipped: number; remaining: number };

    const status: JobStatus = counts.remaining > 0 ? 'processing' : 'complete';

    db.prepare(
      `UPDATE jobs SET done_count = ?, failed_count = ?, skipped_count = ?, status = ? WHERE id = ?`
    ).run(counts.done ?? 0, counts.failed ?? 0, counts.skipped ?? 0, status, jobId);
  }

  return {
    createJob,
    getJob,
    getImages,
    getPendingOrFailedImages,
    updateImageStatus,
    setEditedAltText,
    recomputeValidationFlagsForSku,
    recomputeAllValidationFlags,
    recomputeJobTotals,
  };
}

export type JobStore = ReturnType<typeof createJobStore>;
```

```ts
// src/lib/jobs/jobStoreSingleton.ts
import { db } from '../db';
import { createJobStore } from './jobStore';

export const jobStore = createJobStore(db);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/jobs/jobStore.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/jobs/jobStore.ts src/lib/jobs/jobStoreSingleton.ts tests/lib/jobs/jobStore.test.ts
git commit -m "Add job store with resumable status tracking and flag recompute"
```

---

### Task 9: Retry-with-Backoff Utility

**Files:**
- Create: `src/lib/jobs/retry.ts`
- Test: `tests/lib/jobs/retry.test.ts`

**Interfaces:**
- Produces: `retryWithBackoff<T>(fn: () => Promise<T>, delaysMs?: number[]): Promise<T>` — consumed by Task 13's `processJob`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/jobs/retry.test.ts
import { describe, it, expect, vi } from 'vitest';
import { retryWithBackoff } from '../../../src/lib/jobs/retry';

describe('retryWithBackoff', () => {
  it('returns the result on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await retryWithBackoff(fn, [1]);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and returns the result once it succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('ok');
    const result = await retryWithBackoff(fn, [1, 1, 1]);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws the last error after exhausting all attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));
    await expect(retryWithBackoff(fn, [1, 1])).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/jobs/retry.test.ts`
Expected: FAIL with "Cannot find module '../../../src/lib/jobs/retry'"

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/jobs/retry.ts
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  delaysMs: number[] = [1000, 4000, 10000]
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < delaysMs.length) {
        await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
      }
    }
  }
  throw lastError;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/jobs/retry.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/jobs/retry.ts tests/lib/jobs/retry.test.ts
git commit -m "Add retry-with-backoff utility"
```

---

### Task 10: Image Fetch Module

**Files:**
- Create: `src/lib/images/fetchImage.ts`
- Test: `tests/lib/images/fetchImage.test.ts`

**Interfaces:**
- Produces: `ImageFetchError` (with `reason: 'not_found' | 'forbidden' | 'timeout' | 'other'`), `fetchImage(url: string, timeoutMs?: number): Promise<{ buffer: Buffer; contentType: string }>` — consumed by Task 13's `processJob`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/images/fetchImage.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchImage } from '../../../src/lib/images/fetchImage';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchImage', () => {
  it('returns the buffer and content type on success', async () => {
    const fakeBuffer = new Uint8Array([1, 2, 3]).buffer;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'image/jpeg' },
        arrayBuffer: async () => fakeBuffer,
      })
    );
    const result = await fetchImage('http://example.com/a.jpg');
    expect(result.contentType).toBe('image/jpeg');
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(Array.from(result.buffer)).toEqual([1, 2, 3]);
  });

  it('throws a not_found ImageFetchError on 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404, headers: { get: () => null } })
    );
    await expect(fetchImage('http://example.com/missing.jpg')).rejects.toMatchObject({
      reason: 'not_found',
    });
  });

  it('throws a forbidden ImageFetchError on 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 403, headers: { get: () => null } })
    );
    await expect(fetchImage('http://example.com/blocked.jpg')).rejects.toMatchObject({
      reason: 'forbidden',
    });
  });

  it('sends a browser-like User-Agent and Referer header, following redirects', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    vi.stubGlobal('fetch', fetchMock);
    await fetchImage('http://example.com/a.jpg');
    const [, options] = fetchMock.mock.calls[0];
    expect(options.redirect).toBe('follow');
    expect(options.headers['User-Agent']).toContain('Mozilla');
    expect(options.headers['Referer']).toBe('https://www.menkind.co.uk/');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/images/fetchImage.test.ts`
Expected: FAIL with "Cannot find module '../../../src/lib/images/fetchImage'"

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/images/fetchImage.ts
export interface FetchImageResult {
  buffer: Buffer;
  contentType: string;
}

export class ImageFetchError extends Error {
  reason: 'not_found' | 'forbidden' | 'timeout' | 'other';
  status?: number;

  constructor(message: string, reason: 'not_found' | 'forbidden' | 'timeout' | 'other', status?: number) {
    super(message);
    this.reason = reason;
    this.status = status;
  }
}

export async function fetchImage(url: string, timeoutMs = 30000): Promise<FetchImageResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Referer: 'https://www.menkind.co.uk/',
      },
    });

    if (response.status === 404) throw new ImageFetchError(`Image not found: ${url}`, 'not_found', 404);
    if (response.status === 403) throw new ImageFetchError(`Image forbidden: ${url}`, 'forbidden', 403);
    if (!response.ok) {
      throw new ImageFetchError(`Image fetch failed with status ${response.status}: ${url}`, 'other', response.status);
    }

    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
    const arrayBuffer = await response.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), contentType };
  } catch (err) {
    if (err instanceof ImageFetchError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ImageFetchError(`Image fetch timed out: ${url}`, 'timeout');
    }
    throw new ImageFetchError(`Image fetch error: ${(err as Error).message}`, 'other');
  } finally {
    clearTimeout(timeout);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/images/fetchImage.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/images/fetchImage.ts tests/lib/images/fetchImage.test.ts
git commit -m "Add image fetch module with retail-host-friendly headers"
```

---

### Task 11: Image Downscale Module

**Files:**
- Create: `src/lib/images/downscale.ts`
- Test: `tests/lib/images/downscale.test.ts`

**Interfaces:**
- Produces: `DownscaledImage { buffer: Buffer; mimeType: string }`, `downscaleImage(buffer: Buffer, contentType: string): Promise<DownscaledImage>` — consumed by Task 13's `processJob`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/images/downscale.test.ts
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { downscaleImage } from '../../../src/lib/images/downscale';

async function makeTestJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .jpeg()
    .toBuffer();
}

describe('downscaleImage', () => {
  it('downscales a large jpeg to fit within 1024px', async () => {
    const input = await makeTestJpeg(2000, 1000);
    const result = await downscaleImage(input, 'image/jpeg');
    const meta = await sharp(result.buffer).metadata();
    expect(meta.width).toBeLessThanOrEqual(1024);
    expect(meta.height).toBeLessThanOrEqual(1024);
    expect(result.mimeType).toBe('image/jpeg');
  });

  it('does not enlarge a small image', async () => {
    const input = await makeTestJpeg(200, 100);
    const result = await downscaleImage(input, 'image/jpeg');
    const meta = await sharp(result.buffer).metadata();
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(100);
  });

  it('converts a gif content type to a static png', async () => {
    const input = await makeTestJpeg(300, 300);
    const result = await downscaleImage(input, 'image/gif');
    expect(result.mimeType).toBe('image/png');
    const meta = await sharp(result.buffer).metadata();
    expect(meta.format).toBe('png');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/images/downscale.test.ts`
Expected: FAIL with "Cannot find module '../../../src/lib/images/downscale'"

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/images/downscale.ts
import sharp from 'sharp';

export interface DownscaledImage {
  buffer: Buffer;
  mimeType: string;
}

const MAX_DIMENSION = 1024;

export async function downscaleImage(buffer: Buffer, contentType: string): Promise<DownscaledImage> {
  const isGif = contentType.includes('gif');
  const pipeline = sharp(buffer, isGif ? { animated: false } : undefined).resize({
    width: MAX_DIMENSION,
    height: MAX_DIMENSION,
    fit: 'inside',
    withoutEnlargement: true,
  });

  if (isGif) {
    const outBuffer = await pipeline.png().toBuffer();
    return { buffer: outBuffer, mimeType: 'image/png' };
  }

  const outBuffer = await pipeline.jpeg({ quality: 85 }).toBuffer();
  return { buffer: outBuffer, mimeType: 'image/jpeg' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/images/downscale.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/images/downscale.ts tests/lib/images/downscale.test.ts
git commit -m "Add image downscale module"
```

---

### Task 12: Gemini System Prompt, Client, and Alt Text Generation

**Files:**
- Create: `src/lib/gemini/systemPrompt.ts`
- Create: `src/lib/gemini/client.ts`
- Create: `src/lib/gemini/generateAltText.ts`
- Test: `tests/lib/gemini/generateAltText.test.ts`

**Interfaces:**
- Produces: `ALT_TEXT_SYSTEM_PROMPT: string`, `createGeminiClient(apiKey: string): GoogleGenerativeAI`, `GenerateAltTextInput { imageBuffer: Buffer; mimeType: string; productName: string }`, `generateAltText(client: GoogleGenerativeAI, input: GenerateAltTextInput): Promise<string>` — consumed by Task 13's `processJob` and Task 15's API routes.

- [ ] **Step 1: Write the system prompt and client factory (no test needed — pure constant and a thin SDK wrapper exercised by the next step's test)**

```ts
// src/lib/gemini/systemPrompt.ts
export const ALT_TEXT_SYSTEM_PROMPT = `You are writing alt text for e-commerce product images. Follow these rules exactly:

1. Be descriptive: clearly describe what is visible in the image, including relevant details that add context.
2. Keep it short: aim for 8-12 words. Avoid lengthy or overly complex descriptions.
3. Include keywords naturally: if the product name suggests obvious keywords, let them appear naturally in the description. Never stuff keywords.
4. Never start with "Image of", "Picture of", or "Photo of" — screen readers already announce it's an image.
5. Be specific, not generic: mention exactly what the image shows rather than a vague description.
6. Avoid redundancy: don't just restate the product name — describe what is actually visible (angle, setting, color, packaging, in-use, etc.).
7. Every image given to you is a real product photo, so always produce a description.
8. If the image contains visible text (packaging copy, instructions, callouts), briefly mention the key point of that text.
9. Write for someone who cannot see the image and is relying on a screen reader — clarity over cleverness.

Respond with ONLY the alt text itself — no quotation marks, no preamble, no explanation.`;
```

```ts
// src/lib/gemini/client.ts
import { GoogleGenerativeAI } from '@google/generative-ai';

export function createGeminiClient(apiKey: string): GoogleGenerativeAI {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set');
  }
  return new GoogleGenerativeAI(apiKey);
}
```

- [ ] **Step 2: Write the failing test for `generateAltText`**

```ts
// tests/lib/gemini/generateAltText.test.ts
import { describe, it, expect, vi } from 'vitest';
import { generateAltText } from '../../../src/lib/gemini/generateAltText';
import type { GoogleGenerativeAI } from '@google/generative-ai';

describe('generateAltText', () => {
  it('sends the image and product name and returns trimmed text', async () => {
    const generateContent = vi.fn().mockResolvedValue({
      response: { text: () => '  A red widget on a white background  ' },
    });
    const getGenerativeModel = vi.fn().mockReturnValue({ generateContent });
    const fakeClient = { getGenerativeModel } as unknown as GoogleGenerativeAI;

    const result = await generateAltText(fakeClient, {
      imageBuffer: Buffer.from([1, 2, 3]),
      mimeType: 'image/jpeg',
      productName: 'Red Widget',
    });

    expect(result).toBe('A red widget on a white background');
    expect(getGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-2.0-flash' })
    );
    const [parts] = generateContent.mock.calls[0];
    expect(parts[0].inlineData.mimeType).toBe('image/jpeg');
    expect(parts[1].text).toContain('Red Widget');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/lib/gemini/generateAltText.test.ts`
Expected: FAIL with "Cannot find module '../../../src/lib/gemini/generateAltText'"

- [ ] **Step 4: Write the implementation**

```ts
// src/lib/gemini/generateAltText.ts
import type { GoogleGenerativeAI } from '@google/generative-ai';
import { ALT_TEXT_SYSTEM_PROMPT } from './systemPrompt';

export interface GenerateAltTextInput {
  imageBuffer: Buffer;
  mimeType: string;
  productName: string;
}

const MODEL_NAME = 'gemini-2.0-flash';

export async function generateAltText(
  client: GoogleGenerativeAI,
  input: GenerateAltTextInput
): Promise<string> {
  const model = client.getGenerativeModel({
    model: MODEL_NAME,
    systemInstruction: ALT_TEXT_SYSTEM_PROMPT,
  });

  const result = await model.generateContent([
    { inlineData: { data: input.imageBuffer.toString('base64'), mimeType: input.mimeType } },
    { text: `Product name: ${input.productName}\n\nWrite the alt text for this product image.` },
  ]);

  return result.response.text().trim();
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/lib/gemini/generateAltText.test.ts`
Expected: PASS (1 test)

- [ ] **Step 6: Commit**

```bash
git add src/lib/gemini tests/lib/gemini/generateAltText.test.ts
git commit -m "Add Gemini system prompt, client factory, and alt text generation"
```

---

### Task 13: Job Processing Orchestration

**Files:**
- Create: `src/lib/jobs/processJob.ts`
- Test: `tests/lib/jobs/processJob.test.ts`

**Interfaces:**
- Consumes: `JobStore` (Task 8), `fetchImage` (Task 10), `downscaleImage` (Task 11), `generateAltText` (Task 12), `retryWithBackoff` (Task 9).
- Produces: `ProcessJobDeps { store: JobStore; geminiClient: GoogleGenerativeAI; maxConcurrency?: number }`, `processJob(jobId: string, deps: ProcessJobDeps): Promise<void>` — consumed by Task 15's process and retry routes.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/jobs/processJob.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDb } from '../../../src/lib/db';
import { createJobStore } from '../../../src/lib/jobs/jobStore';
import { processJob } from '../../../src/lib/jobs/processJob';

vi.mock('../../../src/lib/images/fetchImage', () => ({
  fetchImage: vi.fn().mockResolvedValue({ buffer: Buffer.from([1]), contentType: 'image/jpeg' }),
}));
vi.mock('../../../src/lib/images/downscale', () => ({
  downscaleImage: vi.fn().mockResolvedValue({ buffer: Buffer.from([1]), mimeType: 'image/jpeg' }),
}));
vi.mock('../../../src/lib/gemini/generateAltText', () => ({
  generateAltText: vi.fn().mockResolvedValue('A red widget on a white background shown here'),
}));

describe('processJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('processes all pending images and marks the job complete', async () => {
    const db = createDb(':memory:');
    const store = createJobStore(db);
    const job = store.createJob('test.csv', [
      { sku: 'SKU1', productName: 'Widget', imageId: '1', imageUrl: 'http://a/1.jpg', existingDescription: '', sortOrder: 0, slotIndex: 1 },
    ]);

    await processJob(job.id, { store, geminiClient: {} as any, maxConcurrency: 1 });

    const images = store.getImages(job.id);
    expect(images[0].status).toBe('done');
    expect(images[0].generatedAltText).toBe('A red widget on a white background shown here');
    const updatedJob = store.getJob(job.id);
    expect(updatedJob?.status).toBe('complete');
    expect(updatedJob?.doneCount).toBe(1);
  });

  it('marks an image failed when fetching throws, without stalling the rest of the batch', async () => {
    const { fetchImage } = await import('../../../src/lib/images/fetchImage');
    (fetchImage as any).mockRejectedValueOnce(new Error('404 not found'));

    const db = createDb(':memory:');
    const store = createJobStore(db);
    const job = store.createJob('test.csv', [
      { sku: 'SKU1', productName: 'Widget', imageId: '1', imageUrl: 'http://a/1.jpg', existingDescription: '', sortOrder: 0, slotIndex: 1 },
      { sku: 'SKU1', productName: 'Widget', imageId: '2', imageUrl: 'http://a/2.jpg', existingDescription: '', sortOrder: 1, slotIndex: 2 },
    ]);

    await processJob(job.id, { store, geminiClient: {} as any, maxConcurrency: 2 });

    const images = store.getImages(job.id);
    const failed = images.find((i) => i.imageUrl === 'http://a/1.jpg');
    const done = images.find((i) => i.imageUrl === 'http://a/2.jpg');
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toContain('404');
    expect(done?.status).toBe('done');
    const updatedJob = store.getJob(job.id);
    expect(updatedJob?.failedCount).toBe(1);
    expect(updatedJob?.doneCount).toBe(1);
  });

  it('only reprocesses pending/failed images, leaving done ones untouched (resume semantics)', async () => {
    const { generateAltText } = await import('../../../src/lib/gemini/generateAltText');
    const db = createDb(':memory:');
    const store = createJobStore(db);
    const job = store.createJob('test.csv', [
      { sku: 'SKU1', productName: 'Widget', imageId: '1', imageUrl: 'http://a/1.jpg', existingDescription: '', sortOrder: 0, slotIndex: 1 },
      { sku: 'SKU1', productName: 'Widget', imageId: '2', imageUrl: 'http://a/2.jpg', existingDescription: '', sortOrder: 1, slotIndex: 2 },
    ]);
    const images = store.getImages(job.id);
    store.updateImageStatus(images[0].id, { status: 'done', generatedAltText: 'already done text here' });

    await processJob(job.id, { store, geminiClient: {} as any, maxConcurrency: 2 });

    expect(generateAltText).toHaveBeenCalledTimes(1);
    const updated = store.getImages(job.id);
    expect(updated.find((i) => i.id === images[0].id)?.generatedAltText).toBe('already done text here');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/jobs/processJob.test.ts`
Expected: FAIL with "Cannot find module '../../../src/lib/jobs/processJob'"

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/jobs/processJob.ts
import pLimit from 'p-limit';
import type { GoogleGenerativeAI } from '@google/generative-ai';
import type { JobStore } from './jobStore';
import { fetchImage } from '../images/fetchImage';
import { downscaleImage } from '../images/downscale';
import { generateAltText } from '../gemini/generateAltText';
import { retryWithBackoff } from './retry';

export interface ProcessJobDeps {
  store: JobStore;
  geminiClient: GoogleGenerativeAI;
  maxConcurrency?: number;
}

export async function processJob(jobId: string, deps: ProcessJobDeps): Promise<void> {
  const concurrency = deps.maxConcurrency ?? Number(process.env.GEMINI_MAX_CONCURRENCY ?? 3);
  const limit = pLimit(concurrency);
  const images = deps.store.getPendingOrFailedImages(jobId);

  await Promise.all(
    images.map((image) =>
      limit(async () => {
        deps.store.updateImageStatus(image.id, { status: 'processing' });
        try {
          const fetched = await fetchImage(image.imageUrl);
          const { buffer, mimeType } = await downscaleImage(fetched.buffer, fetched.contentType);
          const altText = await retryWithBackoff(() =>
            generateAltText(deps.geminiClient, {
              imageBuffer: buffer,
              mimeType,
              productName: image.productName,
            })
          );
          deps.store.updateImageStatus(image.id, { status: 'done', generatedAltText: altText, error: null });
        } catch (err) {
          deps.store.updateImageStatus(image.id, {
            status: 'failed',
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      })
    )
  );

  deps.store.recomputeAllValidationFlags(jobId);
  deps.store.recomputeJobTotals(jobId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/jobs/processJob.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/jobs/processJob.ts tests/lib/jobs/processJob.test.ts
git commit -m "Add concurrency-limited, resumable batch job processing"
```

---

### Task 14: API Route — Create Job (Upload)

**Files:**
- Create: `src/app/api/jobs/route.ts`
- Test: `tests/app/api/jobs/route.test.ts`

**Interfaces:**
- Consumes: `parseExportCsv` (Task 5), `jobStore` (Task 8).
- Produces: `POST /api/jobs` — accepts `multipart/form-data` with a `file` field, returns `201` with the created `Job`, or `400` on missing/empty file.

- [ ] **Step 1: Write the failing test**

```ts
// tests/app/api/jobs/route.test.ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/app/api/jobs/route.test.ts`
Expected: FAIL with "Cannot find module '../../../../src/app/api/jobs/route'"

- [ ] **Step 3: Write the implementation**

```ts
// src/app/api/jobs/route.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/app/api/jobs/route.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/jobs/route.ts tests/app/api/jobs/route.test.ts
git commit -m "Add job creation API route"
```

---

### Task 15: API Routes — Process, Status, Images, Edit/Retry, Export

**Files:**
- Create: `src/app/api/jobs/[id]/process/route.ts`
- Create: `src/app/api/jobs/[id]/status/route.ts`
- Create: `src/app/api/jobs/[id]/images/route.ts`
- Create: `src/app/api/jobs/[id]/images/[imageId]/route.ts`
- Create: `src/app/api/jobs/[id]/export/route.ts`
- Test: `tests/app/api/jobs/id-process.test.ts`
- Test: `tests/app/api/jobs/id-images.test.ts`
- Test: `tests/app/api/jobs/id-export.test.ts`

**Interfaces:**
- Consumes: `jobStore` (Task 8), `processJob` (Task 13), `createGeminiClient` (Task 12), `buildExportCsv` (Task 6).
- Produces: `POST /api/jobs/:id/process` (202, fire-and-forget start/resume), `GET /api/jobs/:id/status` (200 `Job` or 404), `GET /api/jobs/:id/images` (200 `ImageRecord[]` or 404), `PATCH /api/jobs/:id/images/:imageId` (edit and/or retry, 200 updated `ImageRecord` or 404), `GET /api/jobs/:id/export` (200 CSV, 409 with `{ unresolvedCount }` if unconfirmed, 404).

- [ ] **Step 1: Write the failing test for the process route**

```ts
// tests/app/api/jobs/id-process.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../src/lib/jobs/jobStoreSingleton', () => ({
  jobStore: { getJob: vi.fn() },
}));
vi.mock('../../../../src/lib/jobs/processJob', () => ({
  processJob: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../../src/lib/gemini/client', () => ({
  createGeminiClient: vi.fn().mockReturnValue({}),
}));

import { POST } from '../../../../src/app/api/jobs/[id]/process/route';
import { jobStore } from '../../../../src/lib/jobs/jobStoreSingleton';
import { processJob } from '../../../../src/lib/jobs/processJob';

describe('POST /api/jobs/:id/process', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when the job does not exist', async () => {
    (jobStore.getJob as any).mockReturnValue(undefined);
    const response = await POST({} as any, { params: { id: 'missing' } });
    expect(response.status).toBe(404);
  });

  it('starts processing and returns 202 immediately without awaiting completion', async () => {
    (jobStore.getJob as any).mockReturnValue({ id: 'job-1', status: 'pending' });
    const response = await POST({} as any, { params: { id: 'job-1' } });
    expect(response.status).toBe(202);
    expect(processJob).toHaveBeenCalledWith('job-1', expect.objectContaining({ store: jobStore }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/app/api/jobs/id-process.test.ts`
Expected: FAIL with "Cannot find module '../../../../src/app/api/jobs/[id]/process/route'"

- [ ] **Step 3: Write the process, status, and images-list routes**

```ts
// src/app/api/jobs/[id]/process/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { jobStore } from '../../../../../lib/jobs/jobStoreSingleton';
import { processJob } from '../../../../../lib/jobs/processJob';
import { createGeminiClient } from '../../../../../lib/gemini/client';

export const runtime = 'nodejs';

const runningJobs = new Set<string>();

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const job = jobStore.getJob(params.id);
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  if (runningJobs.has(params.id)) {
    return NextResponse.json({ status: 'already_processing' }, { status: 202 });
  }

  runningJobs.add(params.id);
  const geminiClient = createGeminiClient(process.env.GEMINI_API_KEY ?? '');

  processJob(params.id, { store: jobStore, geminiClient })
    .catch((err) => {
      console.error(`Job ${params.id} processing failed:`, err);
    })
    .finally(() => {
      runningJobs.delete(params.id);
    });

  return NextResponse.json({ status: 'started' }, { status: 202 });
}
```

```ts
// src/app/api/jobs/[id]/status/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { jobStore } from '../../../../../lib/jobs/jobStoreSingleton';

export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const job = jobStore.getJob(params.id);
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }
  return NextResponse.json(job);
}
```

```ts
// src/app/api/jobs/[id]/images/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { jobStore } from '../../../../../lib/jobs/jobStoreSingleton';

export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const job = jobStore.getJob(params.id);
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }
  const images = jobStore.getImages(params.id);
  return NextResponse.json(images);
}
```

- [ ] **Step 4: Run the process route test to verify it passes**

Run: `npx vitest run tests/app/api/jobs/id-process.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the failing test for the edit/retry route**

```ts
// tests/app/api/jobs/id-images.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sampleImage = {
  id: 1,
  jobId: 'job-1',
  sku: 'SKU1',
  productName: 'Widget',
  imageId: '111',
  imageUrl: 'http://a/1.jpg',
  existingDescription: '',
  sortOrder: 0,
  slotIndex: 1,
  status: 'done',
  generatedAltText: 'A red widget on a table',
  editedAltText: null,
  validationFlags: null,
  error: null,
};

vi.mock('../../../../src/lib/jobs/jobStoreSingleton', () => ({
  jobStore: {
    getImages: vi.fn(),
    setEditedAltText: vi.fn(),
    recomputeValidationFlagsForSku: vi.fn(),
    updateImageStatus: vi.fn(),
  },
}));
vi.mock('../../../../src/lib/jobs/processJob', () => ({
  processJob: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../../src/lib/gemini/client', () => ({
  createGeminiClient: vi.fn().mockReturnValue({}),
}));

import { PATCH } from '../../../../src/app/api/jobs/[id]/images/[imageId]/route';
import { jobStore } from '../../../../src/lib/jobs/jobStoreSingleton';

describe('PATCH /api/jobs/:id/images/:imageId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (jobStore.getImages as any).mockReturnValue([sampleImage]);
  });

  it('returns 404 when the image does not belong to the job', async () => {
    (jobStore.getImages as any).mockReturnValue([]);
    const request = new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({}) });
    const response = await PATCH(request as any, { params: { id: 'job-1', imageId: '999' } });
    expect(response.status).toBe(404);
  });

  it('saves an edited alt text and recomputes flags for the product', async () => {
    const request = new Request('http://localhost', {
      method: 'PATCH',
      body: JSON.stringify({ editedAltText: 'A blue widget on a shelf' }),
    });
    await PATCH(request as any, { params: { id: 'job-1', imageId: '1' } });
    expect(jobStore.setEditedAltText).toHaveBeenCalledWith(1, 'A blue widget on a shelf');
    expect(jobStore.recomputeValidationFlagsForSku).toHaveBeenCalledWith('job-1', 'SKU1');
  });

  it('resets status to pending and kicks off reprocessing on retry', async () => {
    const request = new Request('http://localhost', {
      method: 'PATCH',
      body: JSON.stringify({ retry: true }),
    });
    await PATCH(request as any, { params: { id: 'job-1', imageId: '1' } });
    expect(jobStore.updateImageStatus).toHaveBeenCalledWith(1, { status: 'pending', error: null });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/app/api/jobs/id-images.test.ts`
Expected: FAIL with "Cannot find module '../../../../src/app/api/jobs/[id]/images/[imageId]/route'"

- [ ] **Step 7: Write the images/[imageId] route**

```ts
// src/app/api/jobs/[id]/images/[imageId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { jobStore } from '../../../../../../lib/jobs/jobStoreSingleton';
import { processJob } from '../../../../../../lib/jobs/processJob';
import { createGeminiClient } from '../../../../../../lib/gemini/client';

export const runtime = 'nodejs';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; imageId: string } }
): Promise<NextResponse> {
  const body = (await request.json()) as { editedAltText?: string; retry?: boolean };
  const imageId = Number(params.imageId);

  const images = jobStore.getImages(params.id);
  const image = images.find((i) => i.id === imageId);
  if (!image) {
    return NextResponse.json({ error: 'Image not found' }, { status: 404 });
  }

  if (typeof body.editedAltText === 'string') {
    jobStore.setEditedAltText(imageId, body.editedAltText);
    jobStore.recomputeValidationFlagsForSku(params.id, image.sku);
  }

  if (body.retry) {
    jobStore.updateImageStatus(imageId, { status: 'pending', error: null });
    const geminiClient = createGeminiClient(process.env.GEMINI_API_KEY ?? '');
    processJob(params.id, { store: jobStore, geminiClient, maxConcurrency: 1 }).catch((err) => {
      console.error(`Retry for image ${imageId} failed:`, err);
    });
  }

  const updated = jobStore.getImages(params.id).find((i) => i.id === imageId);
  return NextResponse.json(updated);
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/app/api/jobs/id-images.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 9: Write the failing test for the export route**

```ts
// tests/app/api/jobs/id-export.test.ts
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

import { GET } from '../../../../src/app/api/jobs/[id]/export/route';
import { jobStore } from '../../../../src/lib/jobs/jobStoreSingleton';

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
});
```

- [ ] **Step 10: Run test to verify it fails**

Run: `npx vitest run tests/app/api/jobs/id-export.test.ts`
Expected: FAIL with "Cannot find module '../../../../src/app/api/jobs/[id]/export/route'"

- [ ] **Step 11: Write the export route**

```ts
// src/app/api/jobs/[id]/export/route.ts
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

  const csv = buildExportCsv(
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

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="alt-text-export-${params.id}.csv"`,
    },
  });
}
```

- [ ] **Step 12: Run test to verify it passes**

Run: `npx vitest run tests/app/api/jobs/id-export.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 13: Run the full test suite**

Run: `npm test`
Expected: all test files pass.

- [ ] **Step 14: Commit**

```bash
git add src/app/api/jobs tests/app/api/jobs
git commit -m "Add process, status, images, edit/retry, and export API routes"
```

---

### Task 16: Upload Page UI

**Files:**
- Modify: `src/app/page.tsx` (replaces Task 1's placeholder)

**Interfaces:**
- Consumes: `POST /api/jobs` and `POST /api/jobs/:id/process` (Task 14, Task 15).
- Produces: the app's `/` route — a file upload form that creates a job, kicks off processing, and navigates to its review page.

No automated test for this task — Next.js client-page interactions are covered by Task 18's manual smoke test, consistent with the spec's testing scope (unit tests for parsing/export/validator logic, manual end-to-end for the UI/pipeline).

- [ ] **Step 1: Replace the placeholder page**

```tsx
// src/app/page.tsx
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
```

- [ ] **Step 2: Verify it type-checks and builds**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "Add upload page UI"
```

---

### Task 17: Review Page UI

**Files:**
- Create: `src/app/jobs/[id]/review/page.tsx`

**Interfaces:**
- Consumes: `GET /api/jobs/:id/status`, `GET /api/jobs/:id/images`, `PATCH /api/jobs/:id/images/:imageId`, `GET /api/jobs/:id/export` (Tasks 14-15).
- Produces: the app's `/jobs/[id]/review` route — polls job progress, shows a grouped-by-product editable table with validation flags, retry, and export.

No automated test for this task, for the same reason as Task 16 — covered by Task 18's manual smoke test.

- [ ] **Step 1: Write the review page**

```tsx
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
  validationFlags: ValidationFlags | null;
  error: string | null;
}

export default function ReviewPage({ params }: { params: { id: string } }) {
  const [job, setJob] = useState<Job | null>(null);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [exportError, setExportError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [jobRes, imagesRes] = await Promise.all([
      fetch(`/api/jobs/${params.id}/status`),
      fetch(`/api/jobs/${params.id}/images`),
    ]);
    if (jobRes.ok) setJob(await jobRes.json());
    if (imagesRes.ok) setImages(await imagesRes.json());
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
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/jobs
git commit -m "Add review page UI with editing, retry, and export"
```

---

### Task 18: Manual End-to-End Smoke Test

**Files:** none (verification task only)

**Interfaces:** none — this task exercises the whole pipeline built in Tasks 1-17 against real data.

- [ ] **Step 1: Build a small real-data fixture**

From the real export at `C:\Users\samuel\Downloads\Direct Dispatch Image Links Export 08.07.2026.csv`, copy the header row plus 5 data rows into a new file `smoke-test-export.csv` in the project root — pick at least one product with more than 13 images to exercise the dynamic slot width. Do not commit this file (it's real production data); it's a local scratch fixture only.

- [ ] **Step 2: Start the app**

Run: `npm run dev`
Expected: server starts on `http://localhost:3000` with no errors.

- [ ] **Step 3: Upload and process**

In a browser, go to `http://localhost:3000`, choose `smoke-test-export.csv`, and submit. Expected: redirected to `/jobs/<id>/review`, progress counter increases over the next 1-2 minutes as each image is fetched from `www.menkind.co.uk`, downscaled, and sent to Gemini.

Verify specifically:
- No image fetch fails with a 403 (confirms the User-Agent/Referer headers work against the real host).
- The product with >13 images shows all of its images in the review table, not truncated.
- At least one generated alt text is 8-12 words and doesn't start with "Image of"/"Picture of".

- [ ] **Step 4: Exercise edit and retry**

Edit one alt text field and confirm (via a page refresh) the edit persisted. If any image failed, click retry and confirm it moves back to `processing` then `done`.

- [ ] **Step 5: Export and verify against the real import format**

Click "Export CSV", open the downloaded file, and confirm:
- The header matches the `Name, SKU, Image 1 ID, Image 1 File, Image 1 Description, Image 1 Sort Order, ...` shape from `C:\Users\samuel\Downloads\Alt Text.csv`.
- `Image N ID`, `Image N File`, and `Image N Sort Order` values match the source export exactly for each image.
- `Image N Description` values are the approved alt text.

- [ ] **Step 6: Confirm the re-import path with the business owner**

Since this repo has no BigCommerce sandbox access, hand the exported CSV to the person who runs the bulk alt-text import app and confirm it imports cleanly against one real test product before running the full ~2,700-image batch.

---

