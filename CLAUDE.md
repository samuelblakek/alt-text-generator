# Alt Text Generator

Internal Menkind tool: takes a BigCommerce product-image export CSV, generates
guideline-compliant alt text via Google Gemini, lets a human review/edit
before export, and produces a CSV for the BigCommerce bulk alt-text import
app.

**Status as of 2026-07-14:** Shipped and deployed. Currently iterating on
UI/visual design with the user selecting specific page elements in-browser
for feedback.

## Architecture

- Next.js 14 (App Router) + TypeScript, single app.
- SQLite (`better-sqlite3`) job store — resumable batch processing (`src/lib/jobs/processJob.ts`),
  tracks per-image status (`pending`/`processing`/`done`/`failed`/`skipped`).
- Pipeline: upload CSV → parse (`src/lib/csv/parseExport.ts`) → fetch each
  image → downscale (`sharp`) → Gemini generates alt text
  (`src/lib/gemini/generateAltText.ts`) → local validator flags issues
  (`src/lib/validator/validateAltText.ts`) → human review page → export CSV
  (`src/lib/csv/buildExport.ts`, URL-path-matched, dynamic column width).
- Two pages: `/` (upload, with model selector) and `/jobs/[id]/review`
  (edit/retry/regenerate-with-hint/export).
- `src/middleware.ts` gates the whole app behind HTTP Basic Auth (only active
  when `BASIC_AUTH_USER`/`BASIC_AUTH_PASSWORD` env vars are set — unset
  locally so dev has no auth gate).

## Key decisions worth knowing

- Gemini model is **not hardcoded to one string** — `gemini-2.0-flash` (the
  original choice) was retired by Google mid-project with zero notice. Model
  is now user-selectable per job (`gemini-3.5-flash` default / `gemini-2.5-pro`
  quality option), validated server-side against an allowlist
  (`src/lib/gemini/models.ts`).
- All generated alt text must be **British English** — enforced via the
  Gemini system prompt (`src/lib/gemini/systemPrompt.ts`), not post-processing.
- Export CSV excludes unresolved (pending/failed) images entirely rather than
  writing a blank description — deliberate choice to avoid overwriting real
  BigCommerce alt text with nothing. Confirmed with the user.
- Regenerate accepts an optional reviewer hint (e.g. "this is a stopwatch,
  not a mug") passed to Gemini as extra context, for when the model
  misidentifies an image.

## Local dev

**Node version matters.** `better-sqlite3` has no prebuilt binary for the
machine's default Node (v26.4.0) on this Windows box — use Node 24 LTS via
nvm-windows for local dev:
```
"/c/Users/samuel/AppData/Local/nvm/nvm.exe" use 24.18.0
export PATH="/c/nvm4w/nodejs:$PATH"
```
Switch back to `26.4.0` when done (it's the user's system-wide default,
shared with other projects).

```
npm install
npm run dev      # http://localhost:3000, no auth gate (env vars unset)
npm test         # vitest, 75 tests
npx tsc --noEmit
```

`.env` needs `GEMINI_API_KEY` (same value as sibling projects
`amazon-content-generator` / `mk-qa-generator` — copy via
`grep "^GEMINI_API_KEY=" ../amazon-content-generator/.env > .env`, never
paste the value directly) and `GEMINI_MAX_CONCURRENCY=3`.

## Deployment

Hosted on Fly.io: **https://menkind-alt-text-generator.fly.dev**
- App: `menkind-alt-text-generator`, region `lhr`, org `personal`.
- Persistent volume `alt_text_data` (1GB) mounted at `/data` for the SQLite file.
- Secrets (`GEMINI_API_KEY`, `BASIC_AUTH_USER`, `BASIC_AUTH_PASSWORD`) set via
  `flyctl secrets set`, never committed.
- Docker build **must use `node:22-slim`**, not 24 — same better-sqlite3
  prebuilt-binary gap as local dev, but on Linux this time. Don't "fix" the
  Dockerfile back to Node 24.
- `auto_stop_machines = "stop"`, `min_machines_running = 0` — the machine
  spins down when idle. The review page's polling has try/catch around every
  fetch specifically because of this (see commit `fd9ccda`) — don't remove
  that error handling, a cold-starting machine will otherwise throw.
- Redeploy: `flyctl deploy --app menkind-alt-text-generator` from repo root
  (builds remotely on Fly's builders, no local Docker needed).

## Workflow used for this project

Every feature went through: brainstorm → written spec (`docs/superpowers/specs/`)
→ implementation plan (`docs/superpowers/plans/`) → subagent-driven
implementation (fresh implementer + independent reviewer per task, in a git
worktree under `.worktrees/`) → merge to `master` → push. Bugs found via
live smoke-testing (not just unit tests) got fixed the same way. Continue
this pattern for new work — it caught real issues (retired Gemini model,
webpack native-module resolution, Docker UID conflict) that unit tests
couldn't.
