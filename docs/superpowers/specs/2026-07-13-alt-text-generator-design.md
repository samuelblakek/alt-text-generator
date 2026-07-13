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
- Enforce as much of the 12 alt-text best-practice rules (see Guideline
  enforcement) as is actually determinable from the available data — not
  all 12 are enforceable from a CSV + image bytes alone (see below).
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

Where `Image N File` holds the full image URL. Column width is **dynamic**,
sized to the max number of image slots actually present in the job's data
(the export goes up to 63 slots; the 13-slot sample import file was just a
column-format template, not a fixed limit) — a product with 17 images must
not be truncated to 13.

**Join key: URL path, not full URL.** The export's image URLs
(`http://www.menkind.co.uk/product_images/i/924/126105_100x100__64969.jpg`)
and BigCommerce's live/import URLs (e.g.
`https://store-xxxx.mybigcommerce.com/product_images/i/924/126105_100x100__64969.jpg`)
differ in scheme and host but share the same path
(`/product_images/i/924/126105_100x100__64969.jpg`) — BigCommerce serves the
same CDN path structure regardless of which domain the store is viewed
through. So matching strips scheme + host and compares the path only.

In practice this tool builds its output directly from the export data (each
`ImageRecord` already carries the export's own `imageId`, `imageUrl`, and
`sortOrder`) rather than merging against a second file — `Image N ID`,
`Image N File`, and `Image N Sort Order` are carried through unchanged from
the export; only `Image N Description` is replaced with the approved alt
text. The path-matching rule matters if/when reconciling against a live
BigCommerce export taken through a different domain than the original.

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
   per image slot that has a URL. All catalog product images are treated as
   content-bearing (non-decorative) — there is no signal in the data to
   determine decorative status, so this tool doesn't attempt it; a reviewer
   can blank out an individual alt text in the review UI if they judge an
   image decorative.
2. **Batch process** (concurrency-limited — see rate limits below): fetch
   image bytes from the URL → downscale to ~1024px longest edge (first frame
   only for GIFs) → send to Gemini (`gemini-2.0-flash`, vision-capable) with
   the guideline system prompt + product name as context → store the
   generated alt text → run the local validator → mark `done` or `failed`.
   The image's own **existing** `Product Image Description` is stored for
   reference/diffing in the review UI but is never passed to Gemini as
   context — 66% of existing descriptions in the source data are just the
   bare product name copy-pasted, which would bias generation toward the
   exact "echoed the title" failure the validator checks for.
3. **Review** — grouped-by-product table; edit any alt text inline; flags
   shown next to any image that fails validation; bulk-approve; retry button
   for failed fetches/generations. If a job has any `pending`/`failed`
   records when export is requested, the UI warns "N images unresolved —
   export anyway?" rather than silently excluding them.
4. **Export** — build the import-app-format CSV (dynamic slot width, see
   Output), download.

## Guideline enforcement

The 12 rules split into three tiers, honestly, rather than treating all of
them as equally enforceable:

- **Enforced (prompt + local validator):** word count ~8-12 (soft warning if
  outside range), no "image of"/"picture of" openers, specific rather than
  generic (validator flags alt text identical to the bare product name),
  avoid redundancy (validator flags duplicate alt text across images of the
  same product), describe embedded text (prompt instruction; not separately
  validated).
- **Prompt-only, best-effort (not independently validated):** be
  descriptive, include keywords naturally, write for accessibility.
- **Not determinable from the available inputs, explicitly out of scope:**
  contextual relevance *to the page* the image appears on (no page context
  in a product image export), redundancy *with surrounding captions* (no
  caption data), function-of-link description (no link/target data), and
  performance-based iteration (no analytics feed). These remain rules a
  human reviewer applies at their discretion, not something the tool checks.

Flags surface in the review UI as warnings; export is never auto-blocked —
the human reviewer has final say.

## Error handling

- Image fetch: follow redirects, send a browser-like User-Agent and
  `Referer: https://www.menkind.co.uk/` (menkind.co.uk's product image host
  may otherwise reject bare server-side requests). 404 and 403 are tracked
  as distinct failure reasons. Both → `failed`, shown in review with a retry
  action.
- Gemini API errors (rate limit/timeout) → retry with backoff (1s / 4s /
  10s, 3 attempts), then `failed`.
- Per-image fetch and generation each have a timeout (e.g. 30s) to prevent a
  single hung request from stalling the batch.
- Resuming a job only (re)processes `pending`/`failed` records — `done` and
  `skipped` are left alone.
- Job `status` is `complete` only when every `ImageRecord` is `done` or
  `skipped` (zero `pending`/`failed` remaining).

## Rate limits & volume

The real dataset is **~2,700 images** across 353 products (not a round
"1000+"). Cost on Gemini Flash vision is trivial either way (a few dollars
for the whole batch); the actual constraint is Gemini's **requests-per-minute
quota**, which depends on the API tier in use. Concurrency and backoff
should be derived from the configured tier's RPM rather than a fixed guess —
default to a conservative concurrency (e.g. 3-5 concurrent) with the limit
itself pulled from an env var (`GEMINI_MAX_CONCURRENCY`) so it can be raised
if a paid tier is confirmed. On a free-tier-equivalent RPM this batch could
take on the order of hours; that's expected and is exactly what the
resumable job design accounts for.

## Tech stack

- Next.js 14 (App Router) + TypeScript
- `better-sqlite3` for job/image persistence
- `@google/generative-ai` SDK, model `gemini-2.0-flash`, `GEMINI_API_KEY`
  from `.env` (same variable name convention as `amazon-content-generator`
  and `mk-qa-generator` — copied across, not re-entered)
- `sharp` for image downscaling before sending to Gemini
- `csv-parse` / `csv-stringify` for CSV I/O
- Tailwind CSS for the UI

## Testing

- Unit tests: wide→long CSV parsing (including products with >13 image
  slots), long→wide export building (dynamic slot width), URL-path
  normalization/matching, the guideline validator's flag logic.
- Manual end-to-end smoke test against a small subset (~5 products,
  including at least one with >13 images) of the real export before running
  the full batch — specifically verifying image fetch succeeds against the
  real menkind.co.uk host (redirects/403 handling) and that the exported CSV
  re-imports cleanly into the BigCommerce app on a test product.
