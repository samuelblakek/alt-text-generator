# Alt Text Prompt Refinement — Design Spec

Date: 2026-07-21

## Overview

A colleague tested the app and gave feedback on generated alt text quality, using the
Fizzics DraftPour product images as the main example:

1. Images that contain on-image marketing/callout text (e.g. "Accommodates all cans
   and bottles, including 500ml & 750ml bottles") aren't having that text's *meaning*
   folded into the alt text, even though it often describes something not otherwise
   obvious from the photo alone.
2. Close-up/detail shots (e.g. a close-up of the can/bottle compartment) are described
   as if they were full-product shots — e.g. "The DraftPour beer tap accommodating a
   can next to a pint" for what should read as a close-up of one component.
3. The product name isn't always used accurately/specifically in the generated text.
4. Lifestyle shots (product in a real-world setting) don't get enough background/scene
   description.

Separately, while scoping the fix it came up that the existing 8-12 **word** guideline
(sourced from the original 12-best-practices infographic, see the
[2026-07-13 design spec](2026-07-13-alt-text-generator-design.md)) leaves very little
room to add any of the above. The user's colleague clarified the actual constraint is
125 **characters**, which is meaningfully roomier (~19-20 words) and replaces the word
count as the enforced limit.

## Goals

- On-image marketing/callout text is treated as reliable first-party information and
  its meaning (not verbatim text) is folded into the alt text.
- The model distinguishes close-up/detail shots from full-product/lifestyle shots, and
  close-ups name the specific part/feature in focus rather than describing the whole
  product generically.
- The product is referred to by a short, natural, recognizable name — never a generic
  substitute — preferring brevity over the full catalogue string.
- Lifestyle shots (product in a real-world setting) get specific background/setting
  detail as part of the description.
- The 125-character limit replaces the old 8-12 word guideline everywhere it's
  enforced: the system prompt, the local validator, and the review-page UI label.
- Reviewers get a live character counter while editing alt text, so they can see
  whether an edit fits the limit before saving.

## Non-goals

- **Two-pass generation is not being built now.** If live smoke-testing shows the
  single-call prompt still isn't reliably picking up on-image text or shot framing,
  the documented fallback is a first Gemini call that transcribes/classifies the image,
  feeding into the existing generation call — that's a future spec, not this one.
- No reviewer-supplied shot-type tagging UI (defeats the point of automating the first
  pass).
- No retroactive regeneration of already-reviewed/exported images — this changes
  future generations only. Bulk-regenerating past output isn't in scope for this spec.
- No change to the banned-opener or duplicate-of-product-name validator checks — only
  the word-count check changes shape.

## Design

### 1. Revised system prompt (`src/lib/gemini/systemPrompt.ts`)

Replace the existing 10-rule list with a version that keeps the rules that still apply
unchanged (descriptive, keyword-natural, no "Image of" openers, be specific not
generic, always produce a description, British English, screen-reader clarity, output
format) and revises/adds:

- **Length**: "~125 characters — prioritize product identity and what's happening in
  the image first; background/setting detail can be trimmed if it doesn't fit."
- **On-image text** (replaces the existing "packaging copy" rule, broadened): if the
  image contains overlay/marketing text, callouts, or packaging copy describing a
  feature or capability, treat it as reliable and paraphrase its meaning into the alt
  text — don't transcribe verbatim, and don't withhold it just because the photo shows
  only one example of what the text claims (e.g. a single can when the text says the
  product fits multiple sizes).
- **Shot framing** (new): decide whether the image is a close-up/detail shot focused
  on one component or feature, versus a full-product or lifestyle shot. For close-ups,
  say so and name the specific part in focus (e.g. "close-up of the can and bottle
  compartment") rather than describing the whole product generically.
- **Lifestyle background** (strengthens the existing redundancy rule): when the product
  is shown in a real-world setting rather than a plain studio/product-only shot,
  include specific background/setting detail (surface, surrounding objects, setting)
  as part of the description.
- **Product naming** (new): refer to the product by a short, natural, recognizable
  form of the given product name — never a generic substitute (e.g. "DraftPour", not
  "beer tap") — preferring brevity over the full catalogue string.

### 2. Validator (`src/lib/validator/validateAltText.ts`, `src/types/index.ts`)

- Rename `wordCountOk` to `lengthOk` in the `AltTextFlags` interface (both files) and
  in the review page's usage.
- Replace the word-count computation with a character-count check on the trimmed alt
  text: `lengthOk: trimmed.length >= 40 && trimmed.length <= 125`. The 40-character
  floor preserves the old floor's intent (catch lazy/too-terse output) in character
  terms; 125 is the hard-ish ceiling from the colleague's guidance.
- `bannedPhrase` and `isDuplicateOfProductName` are unchanged.
- Update existing unit tests in `tests/lib/validator/validateAltText.test.ts` for the
  new field name and character-based thresholds.

### 3. Review page UI updates (`src/app/jobs/[id]/review/page.tsx`)

- Rename the "Word count" warning pill (shown when `!image.validationFlags.lengthOk`)
  to "Length".
- **Live character counter**: the alt-text `<textarea>` is currently uncontrolled
  (`defaultValue` + `onBlur`, so edits only persist on blur). Add an `onChange` handler
  that updates a new piece of local state — a `Record<number, number>` of live
  character counts keyed by image id, initialized from each image's current text on
  first render — without changing the existing `onBlur`-only persistence (no extra API
  calls while typing). Render a small counter (e.g. `118 / 125`) next to the existing
  status/warning pills, using the new `success` color (see below) at ≤125 characters
  and the existing `danger` color above 125.

### 4. New `success` color token (`tailwind.config.ts`)

The design system has `danger` and `warning` but no green. Add a `success` token
alongside them, matching the existing muted/professional palette (not a bright
marketing green) — e.g. `#15803d` (a muted forest green with good contrast on white).
Update `docs/design.md`'s color section to document it, consistent with how `danger`
and `warning` are already documented there.

## Testing

- Update `tests/lib/validator/validateAltText.test.ts` for the `lengthOk` rename and
  character-based thresholds (boundary cases at 40, 125, and just outside each).
- No automated test for the live character counter or pill rename (frontend-only, same
  precedent as the review-page-polish spec) — checked via `npx tsc --noEmit` plus a
  manual Browser-pane smoke test.
- **Live smoke test against real images** (same pattern as prior feature rounds): the
  Fizzics DraftPour product's images specifically (overlay-text example, the
  close-up/compartment shot, and a lifestyle shot), comparing generated alt text
  before and after this change. If results are still poor after this change — overlay
  text still ignored, close-ups still described as full-product shots — that's the
  trigger for scoping the Option 2 (two-pass) fallback as a follow-up spec, not for
  iterating further on this single-call prompt.
