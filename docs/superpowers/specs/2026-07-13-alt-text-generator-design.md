# Alt Text Generator — Design Spec

Date: 2026-07-13

## Overview

An internal local web tool that generates BigCommerce-compliant alt text for
product images. It takes a BigCommerce product/image export CSV, fetches each
image, analyzes it with Google Gemini, generates alt text following a fixed
set of guidelines, lets a human review/edit the results, and exports a CSV in
the format required by the BigCommerce bulk alt-text import app.

## Goals

- Turn a BigCommerce product image export into draft alt text for every
  product image, using Gemini's vision + text generation.
- Enforce the 12 alt-text best-practice rules (see Guideline enforcement)
  as hard guardrails, not just a suggestion in the prompt.
- Give a human a review/edit pass before anything is exported — no
  auto-publish.
- Produce an output CSV matching the BigCommerce import app's exact column
  format, ready to re-upload.

## Non-goals

- No direct write to BigCommerce via its API — output is a CSV for the
  existing import app workflow.
- No multi-user auth/accounts — single-user local tool (`npm run dev`).
- Not a hosted/production service.

## Inputs

1. **Source export CSV** (e.g. `Direct Dispatch Image Links Export`) — wide
   format, one row per product, up to N image slots per row. Each image slot
   has: `Product Image File - N`, `Product Image URL - N`,
   `Product Image ID - N`, `Product Image File - N` (duplicate, relative
   path), `Product Image Description - N`, `Product Image Sort - N`.
2. **Alt text guidelines** (12 best practices infographic): be descriptive,
   keep to ~8-12 words, include keywords naturally (no stuffing), avoid
   "image of"/"picture of", be specific, describe function for linked
   images, ensure contextual relevance, avoid redundancy with surrounding
   captions, only write alt text for non-decorative images, describe
   embedded text, write for accessibility/screen readers first, and the text
   should hold up to ongoing review.

## Output

A CSV matching the **BigCommerce bulk alt-text import app** format:

```
Name, SKU, Image 1 ID, Image 1 File, Image 1 Description, Image 1 Sort Order, Image 2 ID, ...
```

Where `Image N File` holds the full image URL. The output is built by taking
each image's **URL as the join key**: `Image N ID`, `Image N File` (URL), and
`Image N Sort Order` are carried through unchanged from the source data;
only `Image N Description` is replaced with the approved alt text. Matching
by URL (not ID, filename, or slot number) because that's the value proven
common between the source export and the import template.

## Architecture

Next.js (App Router, TypeScript) app, run locally:

- `/` — upload page for the source CSV
- `/jobs/[id]/review` — review UI: table grouped by product, thumbnail,
  generated alt text (editable), validation flags, bulk-approve, per-image
  regenerate
- API routes:
  - `POST /api/jobs` — accepts uploaded CSV, parses/flattens it into image
    records, creates a job
  - `POST /api/jobs/[id]/process` — starts/resumes batch processing
  - `GET /api/jobs/[id]/status` — progress polling
  - `GET /api/jobs/[id]/export` — builds and returns the import-format CSV
- Persistence: SQLite (via `better-sqlite3`), file-based, no external DB.
  Every image record's status and result is written as it completes, so a
  job can be closed and resumed without re-processing already-done images
  and without re-spending Gemini calls.

## Data model

**Job**: id, createdAt, sourceFilename, status (`pending`/`processing`/`complete`), totals (image count, done count, failed count)

**ImageRecord**: jobId, sku, productName, imageId, imageUrl, existingDescription, sortOrder, slotIndex, status (`pending`/`processing`/`done`/`failed`/`skipped`), generatedAltText, editedAltText (nullable — overrides generated when set), validationFlags (JSON: wordCountOk, bannedPhrase, isDuplicateOfProductName, etc.), error (nullable)

## Pipeline

1. **Upload & parse** — flatten the wide export CSV into one `ImageRecord`
   per image slot that has a URL.
2. **Batch process** (concurrency-limited, e.g. 5 at a time): fetch image
   bytes from the URL → send to Gemini with the guideline system prompt +
   product name as context → store the generated alt text → run the local
   validator → mark `done` or `failed`.
3. **Review** — grouped-by-product table; edit any alt text inline; flags
   shown next to any image that fails validation; bulk-approve; retry button
   for failed fetches/generations.
4. **Export** — build the import-app-format CSV by URL join, download.

## Guideline enforcement

Two layers:

1. **System prompt** — encodes all 12 rules explicitly, including the
   8-12 word target, banned "image of"/"picture of" openers, and
   specificity over generic description.
2. **Local (non-AI) validator**, run after generation, flags rather than
   blocks:
   - word count outside ~8-12 range
   - starts with a banned phrase
   - alt text identical to the bare product name (i.e. Gemini just echoed
     the title — a common failure mode visible in the source data already)
   - duplicate alt text across multiple images of the same product

Flags surface in the review UI as warnings; export is never auto-blocked —
the human reviewer has final say.

## Error handling

- Broken/404 image URLs → `failed`, shown in review with a retry action,
  excluded from export until resolved.
- Gemini API errors (rate limit/timeout) → retry with backoff (up to 3
  attempts), then `failed`.
- Resuming a job only (re)processes `pending`/`failed` records.

## Tech stack

- Next.js 14 (App Router) + TypeScript
- `better-sqlite3` for job/image persistence
- `@google/generative-ai` SDK, `GEMINI_API_KEY` from `.env` (same variable
  name convention as `amazon-content-generator` and `mk-qa-generator` —
  copied across, not re-entered)
- `csv-parse` / `csv-stringify` for CSV I/O
- Tailwind CSS for the UI

## Testing

- Unit tests: wide→long CSV parsing, long→wide export building (URL join),
  the guideline validator's flag logic.
- Manual end-to-end smoke test against a small subset (~5 products) of the
  real export before running the full batch.
