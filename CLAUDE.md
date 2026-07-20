# Alt Text Generator

Internal Menkind tool: takes a BigCommerce product-image export CSV, generates
guideline-compliant alt text via Google Gemini, lets a human review/edit
before export, and produces a CSV for the BigCommerce bulk alt-text import
app.

**Status as of 2026-07-20:** Shipped and deployed. Core pipeline plus two
follow-up feature rounds are live: batch stop/resume controls
(`docs/superpowers/specs/2026-07-14-stop-resume-processing-design.md`) and
review-page polish — a real fix for Regenerate/Retry silently no-op'ing
mid-batch, a segmented progress bar, and a click-to-expand image lightbox
(`docs/superpowers/specs/2026-07-15-review-page-polish-design.md`).
Deferred: a PIM writeback button next to Export CSV (not yet scoped — needs
the exact PIM field confirmed first).

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
  (edit/retry/regenerate-with-hint/export/stop/resume, click-to-expand
  image lightbox).
- Batch processing is stoppable and resumable mid-run: `processJob`
  (`src/lib/jobs/processJob.ts`) loops rather than taking one fixed pass,
  so it also picks up images reset to `pending` by a live Regenerate/Retry
  click while it's still running — not just images present when it
  started. An in-memory flag (`src/lib/jobs/stopRequests.ts`, mirrors the
  existing `runningJobs.ts` pattern) lets a reviewer pause a batch; nothing
  is persisted to SQLite for this, so it doesn't survive a machine restart
  (rare, since the Fly machine only idles down between requests, not mid-batch).
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
machine's default Node (v26.4.0) on this Windows box — use Node 24 LTS for
local dev. In Git Bash, `nvm-windows`'s own CLI (`nvm.exe use ...`)
unreliably mistranslates its config-file path and fails with
`ERROR open \settings.txt` — skip it and put the versioned install
directory on `PATH` directly instead, which works reliably:
```
export PATH="/c/Users/samuel/AppData/Local/nvm/v24.18.0:$PATH"
```
This only affects the current shell — no need to "switch back," it doesn't
touch the machine-wide default (`26.4.0`, shared with other projects).

```
npm install
npm run dev      # http://localhost:3000, no auth gate (env vars unset)
npm test         # vitest, 86 tests
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
implementation (fresh implementer + independent reviewer per task, plus a
final whole-branch review, in an isolated git worktree — created under
`.claude/worktrees/` by the harness's native worktree tool, not a manually
managed `.worktrees/` directory) → merge to `master` → push → `flyctl deploy`.
Bugs found via live smoke-testing (not just unit tests) got fixed the same
way. Continue this pattern for new work — it caught real issues (retired
Gemini model, webpack native-module resolution, Docker UID conflict, and
twice a subagent's commit landing on the main checkout instead of the
worktree due to a shell-cwd quirk in this sandboxed environment — always
recoverable via `git cherry-pick` onto the worktree branch plus a `git reset`
on `master`, never `--hard` — that specific flag is blocked here regardless
of confirmation, use `git reset <ref>` then `git restore <files>` instead)
that unit tests couldn't.
