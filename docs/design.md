# Design System

The visual design for this tool. It's a dense, functional internal review
tool — not a marketing site. Every choice here favors clarity and speed of
scanning over decoration. When adding UI, follow this rather than
introducing new colors, fonts, or one-off styling.

## Origin

Restyled 2026-07-14, taking *structural* inspiration (typography pairing,
capsule buttons, rounded cards, spacing) from a "Substance Lab" design
system the user provided, but swapping in Menkind's real brand colors and
dropping anything cinematic (video backgrounds, parallax, scroll-reveal
animations, decorative accent type) — those fit a marketing site, not this
tool. Since the first pass, a floating header pill and a serif italic
accent word in headings were tried and then removed (see Amendments below)
after live feedback — this doc reflects the current, amended system, not
the original Substance Lab-inspired draft.

## Colors

Menkind brand palette (exact hex, do not deviate without asking):

| Token (Tailwind) | Hex | Use |
|---|---|---|
| `brand-primary` | `#1e3771` (Menkind Blue) | primary actions, headings emphasis |
| `brand-secondary` | `#1d71b8` (Cool Blue) | secondary accents (e.g. "processing" status) |
| `brand-accent` | `#4c90db` (Electric Blue) | focus rings; progress bar "processing" segment (at 60% opacity, `bg-brand-accent/60`) |
| `background` | `#FBFAF7` | page background |
| `surface-muted` | `#EAF1FB` | muted surfaces (dropzones, muted pills) |
| `border-light` | `rgba(0,0,0,0.1)` | borders, dividers |
| `text-primary` | `#000000` | body/heading text (opacity-scaled for hierarchy, e.g. `/60`, `/70`) |
| `danger` | `#ed1c24` (Menkind Sale) | errors, failed status, destructive actions |
| `warning` | `#b45309` | validation-flag pills |

All tokens live in `tailwind.config.ts`. Extend that file rather than
hardcoding new hex values in components.

## Typography

- **Headings** — Space Grotesk (`font-heading`, `--font-heading`), weight
  300 (light) for page titles. Plain text, no accent styling — see
  Amendments.
- **Body** — Inter (`font-body`, `--font-body`), weights 400/500.
- Loaded via `next/font/google` in `src/app/layout.tsx`.
- Small labels (e.g. "MODEL", "EXPORT FILE") use `text-xs uppercase
  tracking-widest text-text-primary/50` — the *source* text should still be
  written in normal sentence case (e.g. `Model`, `Upload file`); the
  `uppercase` Tailwind class handles the visual transform. Never hardcode
  ALL-CAPS text in JSX — write sentence case and let CSS do the casing.

## Copy conventions

- **Inline pills and small buttons** (status pills, validation-flag pills,
  Regenerate, Retry) are **sentence case** — one capital letter, the rest
  lowercase. This includes generated/dynamic text (e.g. "Word count", "Same
  as product name"). Don't write lowercase pill/button text like
  `regenerate` or `banned phrase`; write `Regenerate`, `Banned phrase`.
- **Primary action buttons** (large capsule CTAs — Export CSV, Upload &
  Start Processing, and similar job-level actions like Stop Processing /
  Resume / Start New Batch) are **Title Case**, matching the two
  established buttons. Don't mix the two conventions within the same
  button group.

Model names shown to the user are humanized, not raw API IDs — e.g.
"Gemini 3.5 Flash", not "gemini-3.5-flash". The raw ID is still the
`value` used internally; only the visible label is humanized.

## Components

- **Cards** — `rounded-lg border border-border-light bg-white p-6 shadow-card`.
- **Buttons (primary)** — capsule/pill shape (`rounded-full`), solid
  `brand-primary` background, white text, soft blue drop shadow
  (`shadow-[0_10px_15px_rgba(30,55,113,0.3)]`), `hover:opacity-90`,
  `disabled:opacity-40`.
- **Buttons (small/inline, e.g. Regenerate, Retry)** — `rounded-full`
  outline style: `border border-{color} px-2.5 py-0.5`, filling solid on
  hover.
- **Status/validation pills** — `rounded-full px-2 py-0.5 text-xs
  font-medium`, background/text color pair from the palette above (muted
  grey for neutral/pending states, warning for validation flags, danger
  for failed/destructive).
- **Inputs** — `rounded-md border border-border-light`, `focus:border-brand-accent`.
- **Border radius scale** — `sm` 4px, `md` 12px, `lg` 16px.
- **Segmented progress bar** — a `bg-surface-muted rounded-full overflow-hidden`
  track containing sequential flex-child `<div>`s (no `rounded-full` on the
  children — the track's own `overflow-hidden` clips them to the pill
  shape), one per status that's "spoken for": `bg-brand-primary` (done/skipped),
  `bg-danger` (failed), `bg-brand-accent/60` (processing). Whatever's left of
  the track's width is implicitly "queued" — there's no separate div for it.
  Compute segment widths from whatever data you already have client-side
  (e.g. the fetched image list) rather than adding a backend field for it.
  Pair with a small legend: an 8×8px `rounded-sm` colored `<span>` immediately
  before each label (`text-xs text-text-primary/50`), not a text description
  of the color.
- **Lightbox/modal overlay** — a `fixed inset-0 bg-black/80` backdrop
  (`flex items-center justify-center`, high `z-index`) whose own `onClick`
  closes it; the enlarged content inside calls `e.stopPropagation()` on its
  own `onClick` so clicking the content itself doesn't close the modal. Keep
  it minimal for this tool — image-only, close via backdrop click or an
  explicit × button, no keyboard handling or gallery navigation unless a
  specific need justifies the extra complexity.

## Amendments (things removed since the first restyle)

These were tried during the initial restyle and explicitly removed after
review — don't reintroduce them:

- **No floating/sticky header pill.** A capsule-shaped site header linking
  back to `/` was removed — it read as decorative chrome with unclear
  purpose on a two-screen internal tool. Where a way back to the upload
  page is genuinely needed (the review page), use a plain text link
  (`← Upload another file`), not a floating pill.
- **No serif italic accent word in headings.** Headings were briefly styled
  with one italic serif word per heading (`font-serif italic`, Instrument
  Serif). Removed — headings are now plain `font-heading` text throughout.
  The Instrument Serif font import and the `serif` Tailwind font-family
  token were removed along with it; don't re-add either without a specific
  reason to bring the accent back.
- **No unused design tokens.** If a token in `tailwind.config.ts` (color,
  shadow, font) stops being referenced anywhere in `src/`, remove it in the
  same change rather than leaving it to drift out of sync with what's
  actually rendered (e.g. `shadow-capsule` was removed when the header pill
  that used it was removed).
