# Alt Text Prompt Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four alt-text quality issues found via colleague feedback (on-image
marketing text ignored, close-ups described like full-product shots, imprecise
product naming, thin lifestyle-shot backgrounds) and switch the enforced length
limit from the old 8-12 word guideline to 125 characters, with a live character
counter in the review UI.

**Architecture:** Single-call prompt revision (Option 1 from the spec) — no new
Gemini API calls, no new modules. Three independent surfaces change: the system
prompt string, the local validator's length check, and the review page's UI
(a renamed warning pill plus a new live counter).

**Tech Stack:** Next.js 14 / TypeScript, Vitest, Tailwind CSS. No new dependencies.

## Global Constraints

- Length limit is **125 characters**, replacing the old 8-12 **word** guideline
  everywhere it's enforced (system prompt, validator, UI label).
- Option 2 (two-pass generation) is explicitly out of scope for this plan — see
  Task 4 for how a poor smoke-test result should be handled instead of expanding
  scope here.
- No retroactive regeneration of already-reviewed/exported images.
- Follow the existing design system (`tailwind.config.ts` / `docs/design.md`) —
  extend it for new colors, never hardcode hex values in components.
- All alt text must stay in British English (system prompt rule, unchanged by
  this plan).

Full context: [2026-07-21 design spec](../specs/2026-07-21-alt-text-prompt-refinement-design.md).

---

### Task 1: Revise the Gemini system prompt

**Files:**
- Modify: `src/lib/gemini/systemPrompt.ts`

**Interfaces:**
- Consumes: nothing new — `ALT_TEXT_SYSTEM_PROMPT` is a plain exported `string`
  constant, already imported as-is by `src/lib/gemini/generateAltText.ts`.
- Produces: same export name and type (`ALT_TEXT_SYSTEM_PROMPT: string`) — no
  signature change, so no other file needs touching for this task.

This task has no unit-testable behavior of its own (it's a static prompt
string sent to a live API) — its "test" is that the existing test suite still
passes (nothing asserts on exact prompt wording, only substring checks in
`tests/lib/gemini/generateAltText.test.ts`) and the real acceptance check
happens in Task 4's live smoke test.

- [ ] **Step 1: Replace the prompt content**

Replace the entire contents of `src/lib/gemini/systemPrompt.ts` with:

```ts
export const ALT_TEXT_SYSTEM_PROMPT = `You are writing alt text for e-commerce product images. Follow these rules exactly:

1. Be descriptive: clearly describe what is visible in the image, including relevant details that add context.
2. Keep it to around 125 characters. Prioritize product identity and what's happening in the image first — background/setting detail can be trimmed if it doesn't fit.
3. Include keywords naturally: if the product name suggests obvious keywords, let them appear naturally in the description. Never stuff keywords.
4. Never start with "Image of", "Picture of", or "Photo of", since screen readers already announce it's an image.
5. Be specific, not generic: mention exactly what the image shows rather than a vague description.
6. Avoid redundancy: don't just restate the product name; describe what is actually visible (angle, setting, colour, packaging, in-use, etc.).
7. Every image given to you is a real product photo, so always produce a description.
8. On-image text: if the image contains overlay/marketing text, callouts, or packaging copy describing a feature or capability, treat it as reliable and paraphrase its meaning into the alt text. Don't transcribe it verbatim, and don't leave it out just because the photo itself only shows one example of what the text describes (e.g. a single can shown when the text says the product fits multiple sizes).
9. Shot framing: decide whether the image is a close-up/detail shot focused on one component or feature, or a full-product/lifestyle shot. For close-ups, say so and name the specific part in focus (e.g. "close-up of the can and bottle compartment") rather than describing the whole product generically.
10. Lifestyle background: when the product is shown in a real-world setting rather than a plain studio/product-only shot, include specific background/setting detail (surface, surrounding objects, setting) as part of the description.
11. Product naming: refer to the product by a short, natural, recognizable form of the given product name — never a generic substitute (e.g. "DraftPour", not "beer tap") — preferring brevity over the full catalogue string.
12. Write for someone who cannot see the image and is relying on a screen reader: clarity over cleverness.
13. Always write in British English: use British spelling and vocabulary (e.g. colour, personalise, favourite, grey, aluminium) rather than American English (color, personalize, favorite, gray, aluminum).

Respond with ONLY the alt text itself: no quotation marks, no preamble, no explanation.`;
```

- [ ] **Step 2: Run the existing Gemini + validator test suites to confirm no regression**

Run: `npx vitest run tests/lib/gemini tests/lib/validator`
Expected: all tests still PASS (they check for product name/hint substrings and
word-count behavior — the word-count assertions will be fixed in Task 2, not
this one, so `tests/lib/validator/validateAltText.test.ts` is expected to still
pass unchanged at this point since Task 2 hasn't touched it yet).

- [ ] **Step 3: Run the type checker**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/gemini/systemPrompt.ts
git commit -m "Revise alt-text system prompt for overlay text, shot framing, naming, and length"
```

---

### Task 2: Switch the validator from word-count to character-count (`lengthOk`)

**Files:**
- Modify: `src/lib/validator/validateAltText.ts`
- Modify: `src/types/index.ts`
- Test: `tests/lib/validator/validateAltText.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `AltTextFlags` (in `validateAltText.ts`) and `ValidationFlags` (in
  `types/index.ts`) both gain a `lengthOk: boolean` field in place of the old
  `wordCountOk: boolean` field. `validateAltText(altText: string, productName:
  string): AltTextFlags` keeps the same signature. Downstream consumers
  (`src/lib/jobs/jobStore.ts`'s `recomputeValidationFlagsForSku`, and
  `src/app/jobs/[id]/review/page.tsx`) need the renamed field — `jobStore.ts`
  needs no code change since it spreads `validateAltText()`'s return value
  generically (`{...base, isDuplicateWithinProduct: ...}`), but the review
  page's local `ValidationFlags` interface and its one usage of the field are
  updated in Task 3, not this task.

Note for context (no action needed): images already processed before this
change have their validation flags stored as a JSON blob in SQLite with the
old `wordCountOk` key. Those aren't retroactively migrated (per the spec's
non-goals) — they'll pick up the new `lengthOk` key automatically the next
time that image is regenerated/retried, since that's what recomputes and
overwrites the stored flags.

- [ ] **Step 1: Update the test file to the new field name and character-based thresholds**

Replace the first `it(...)` block (lines 5-11) in
`tests/lib/validator/validateAltText.test.ts` with:

```ts
  it('flags length outside the 40-125 character range', () => {
    expect(validateAltText('Too short', 'Widget').lengthOk).toBe(false);
    expect(
      validateAltText(
        'A bright red plastic widget standing upright on a plain white table in natural light',
        'Widget'
      ).lengthOk
    ).toBe(true);
    expect(
      validateAltText(
        'A'.repeat(126),
        'Widget'
      ).lengthOk
    ).toBe(false);
  });
```

(Leave the `banned openers` and `bare product name` tests below it unchanged —
they don't reference `wordCountOk`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/validator/validateAltText.test.ts`
Expected: FAIL — `validateAltText(...).lengthOk` is `undefined` because the
implementation still returns `wordCountOk`.

- [ ] **Step 3: Update the validator implementation**

Replace the contents of `src/lib/validator/validateAltText.ts` with:

```ts
export interface AltTextFlags {
  lengthOk: boolean;
  bannedPhrase: boolean;
  isDuplicateOfProductName: boolean;
}

const BANNED_OPENERS = [/^image of\b/i, /^picture of\b/i, /^photo of\b/i];

export function validateAltText(altText: string, productName: string): AltTextFlags {
  const trimmed = altText.trim();
  return {
    lengthOk: trimmed.length >= 40 && trimmed.length <= 125,
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

- [ ] **Step 4: Update the `ValidationFlags` type**

In `src/types/index.ts`, change line 17 from:

```ts
  wordCountOk: boolean;
```

to:

```ts
  lengthOk: boolean;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/lib/validator/validateAltText.test.ts`
Expected: PASS (3 tests in the `validateAltText` describe block, plus the
unchanged `computeDuplicateWithinProduct` tests).

- [ ] **Step 6: Run the full suite and type checker**

Run: `npm test && npx tsc --noEmit`
Expected: `tsc` passes. `npm test` will show failures only in
`src/app/jobs/[id]/review/page.tsx`-adjacent code if anything still references
`wordCountOk` — there are no test files under `tests/` for that page (no
jsdom/component test setup in this project), so this should be a clean PASS.
(Task 3 updates the review page's own reference to this field; if `tsc` above
already passed, that confirms nothing else in `src/` still references
`wordCountOk`.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/validator/validateAltText.ts src/types/index.ts tests/lib/validator/validateAltText.test.ts
git commit -m "Switch alt-text validator from 8-12 word count to 40-125 character length"
```

---

### Task 3: Add a `success` color token, rename the "Word count" pill, and add a live character counter

**Files:**
- Modify: `tailwind.config.ts`
- Modify: `docs/design.md`
- Modify: `src/app/jobs/[id]/review/page.tsx`

**Interfaces:**
- Consumes: `ValidationFlags.lengthOk` (from Task 2 — the review page has its
  own local copy of this interface, not an import, so it needs its own rename).
- Produces: no new exports; this is a leaf UI task.

- [ ] **Step 1: Add the `success` color token**

In `tailwind.config.ts`, add a `success` entry to the `colors` object,
immediately after `danger`:

```ts
        danger: '#ed1c24', // Menkind Sale
        success: '#15803d',
        warning: '#b45309',
```

- [ ] **Step 2: Document the new token**

In `docs/design.md`, add a row to the color table immediately after the
`danger` row:

```
| `danger` | `#ed1c24` (Menkind Sale) | errors, failed status, destructive actions |
| `success` | `#15803d` | live character-counter "within limit" state |
| `warning` | `#b45309` | validation-flag pills |
```

- [ ] **Step 3: Rename the local `ValidationFlags` interface field**

In `src/app/jobs/[id]/review/page.tsx`, change line 18 from:

```ts
  wordCountOk: boolean;
```

to:

```ts
  lengthOk: boolean;
```

- [ ] **Step 4: Rename the warning pill**

In the same file, change (around line 400):

```tsx
                          {image.validationFlags && !image.validationFlags.wordCountOk && (
                            <span className="rounded-full bg-warning/10 px-2 py-0.5 text-warning">Word count</span>
                          )}
```

to:

```tsx
                          {image.validationFlags && !image.validationFlags.lengthOk && (
                            <span className="rounded-full bg-warning/10 px-2 py-0.5 text-warning">Length</span>
                          )}
```

- [ ] **Step 5: Add live character-count state**

In the component body, alongside the existing `hints` state (around line 64),
add:

```ts
  const [liveLengths, setLiveLengths] = useState<Record<number, number>>({});
```

- [ ] **Step 6: Wire the textarea to track live length and render the counter**

Inside the `productImages.map((image) => { ... })` callback, immediately
before the `return (` (i.e. right after the existing `const isQueued = ...`
line, around line 357), add:

```ts
              const currentLength =
                liveLengths[image.id] ?? (image.editedAltText ?? image.generatedAltText ?? '').length;
```

Then change the textarea (around line 381) from:

```tsx
                        <textarea
                          className="w-full rounded-md border border-border-light p-2.5 text-sm text-text-primary focus:border-brand-accent"
                          defaultValue={image.editedAltText ?? image.generatedAltText ?? ''}
                          onBlur={(e) => handleEdit(image.id, e.target.value)}
                          rows={2}
                        />
```

to:

```tsx
                        <textarea
                          className="w-full rounded-md border border-border-light p-2.5 text-sm text-text-primary focus:border-brand-accent"
                          defaultValue={image.editedAltText ?? image.generatedAltText ?? ''}
                          onChange={(e) =>
                            setLiveLengths((prev) => ({ ...prev, [image.id]: e.target.value.length }))
                          }
                          onBlur={(e) => handleEdit(image.id, e.target.value)}
                          rows={2}
                        />
```

Then add the live counter as the first pill in the status/warning row —
change (around line 396):

```tsx
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                          <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_STYLES[image.status]}`}>
                            {STATUS_LABELS[image.status]}
                          </span>
```

to:

```tsx
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                          <span
                            className={`rounded-full px-2 py-0.5 font-medium ${
                              currentLength <= 125 ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
                            }`}
                          >
                            {currentLength} / 125
                          </span>
                          <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_STYLES[image.status]}`}>
                            {STATUS_LABELS[image.status]}
                          </span>
```

- [ ] **Step 7: Run the type checker**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Manual Browser-pane smoke test**

No automated test exists for this page (frontend-only, no jsdom/component
test setup in this project — same precedent as the progress-bar and lightbox
work in the prior review-page-polish feature). Verify manually:

1. Start the dev server (`preview_start` with the `alt-text-generator-dev`
   launch config, or `npm run dev`).
2. Open a job's review page with at least one `done` image (create one via a
   small test upload if none exists).
3. Click into the alt-text textarea and confirm a counter reading
   `N / 125` appears, colored green (`text-success`), matching the current
   text length.
4. Type additional characters until the count exceeds 125 and confirm the
   counter turns red (`text-danger`) in real time, without needing to blur
   the field.
5. Blur the field and confirm the edit still saves as before (existing
   `onBlur` behavior unchanged).
6. Confirm the "Length" pill (renamed from "Word count") still appears
   correctly for any image whose saved alt text is outside 40-125 characters.

- [ ] **Step 9: Commit**

```bash
git add tailwind.config.ts docs/design.md "src/app/jobs/[id]/review/page.tsx"
git commit -m "Add success color, rename Word count pill to Length, add live character counter"
```

---

### Task 4: Live smoke test against real product images

**Files:** none (no code changes — this task validates Tasks 1-3 against real
images, per the spec's testing plan).

**Interfaces:**
- Consumes: the running app (`npm run dev`), `POST /api/jobs` (multipart CSV
  upload), `GET /api/jobs/:id/images`.
- Produces: a written before/after comparison used to decide whether this
  plan's work is sufficient, or whether the Option 2 fallback needs its own
  follow-up spec.

- [ ] **Step 1: Gather real product image URLs**

Using the Browser pane, visit `https://www.menkind.co.uk` and search for a
product with (a) on-image marketing/callout text, (b) a close-up/detail shot,
and (c) a lifestyle shot — the Fizzics DraftPour beer tap (the product from
the original colleague feedback) is the known example if it's still listed.
Collect at least 2-3 real image URLs directly from the page's `<img>` `src`
attributes (or the equivalent product-gallery data).

- [ ] **Step 2: Build a minimal test CSV**

Using the exact column layout `src/lib/csv/parseExport.ts` expects (see
`tests/lib/csv/parseExport.test.ts`'s `makeSlot` helper for the working
format: `file.jpg,{url},{id},d/1/file.jpg,{description},{sort}` per 6-column
slot, after the 3 leading columns `SKU,Product ID,Product Name`), build a CSV
string with one product row and one slot per gathered image URL. Example
shape for 2 images:

```
Product Code/SKU,Product ID,Product Name,Product Image File - 1,Product Image URL - 1,Product Image ID - 1,Product Image File - 1,Product Image Description - 1,Product Image Sort - 1,Product Image File - 2,Product Image URL - 2,Product Image ID - 2,Product Image File - 2,Product Image Description - 2,Product Image Sort - 2
SMOKE1,9001,Fizzics DraftPour Beer Tap,file.jpg,<REAL_URL_1>,1,d/1/file.jpg,,0,file.jpg,<REAL_URL_2>,2,d/1/file.jpg,,1
```

- [ ] **Step 3: Upload via the API directly**

Per the documented workaround for file-input uploads in this Browser pane
(see project `CLAUDE.md`), use `javascript_tool` to build a `FormData`/`Blob`
from the CSV string and `POST` it to `/api/jobs`, rather than driving the
file `<input>` control.

- [ ] **Step 4: Wait for processing and fetch results**

Poll `GET /api/jobs/:id/status` until `status` is no longer `processing`,
then fetch `GET /api/jobs/:id/images` for the generated alt text per image.

- [ ] **Step 5: Compare against the four feedback points**

For each image, check:
- Is on-image marketing/callout text (if present) reflected in the alt text's
  meaning, not just the literal product action?
- Is a close-up/detail shot described as such, naming the specific part in
  focus?
- Is the product referred to by a specific, recognizable name (not a generic
  substitute)?
- Does a lifestyle shot include background/setting detail?
- Is the alt text within roughly 40-125 characters?

- [ ] **Step 6: Decide next steps**

If all/most images show clear improvement on the relevant points: this plan's
work is sufficient — report the before/after comparison to the user as
confirmation.

If overlay text or shot-framing is still consistently missed after this
change: don't iterate further on the single-call prompt within this plan —
that's the documented trigger (per the spec's non-goals) for scoping the
Option 2 (two-pass generation) fallback as its own follow-up spec via a fresh
`superpowers:brainstorming` session.
