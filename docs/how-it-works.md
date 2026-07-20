# Alt Text Generator — How It Works

An internal tool that writes accessibility-friendly product image descriptions, automatically.

## Why we built it

Every product image needs "alt text" — a short written description that screen readers use for visually impaired shoppers, and that also helps SEO. We have thousands of product images with no alt text, or poor auto-generated ones (many are just the product name copy-pasted). Writing these by hand isn't realistic at our catalogue size.

## How it works

1. **Export the product image list from BigCommerce**
   A standard CSV export listing every product and its image URLs.

2. **Upload it to the tool**
   Pick which AI model to use — fast/cheap, or higher quality — and start the run.

3. **The tool looks at every photo and writes a description**
   It fetches each image and asks Google's AI to describe what's actually in the picture, following our alt-text guidelines: short, specific, no "image of...", written in British English.

4. **A person reviews before anything goes live**
   A simple review page shows every photo next to its suggested description. Anyone can edit the text, or click "regenerate" — optionally adding a hint (e.g. "this is a stopwatch, not a mug") if the AI got something wrong.

5. **Export and re-import to BigCommerce**
   Once happy, export a file in the exact format our BigCommerce import app expects, and upload it back.

## Good to know

- Nothing is ever published without a human looking at it first.
- If the tool is interrupted partway through a large batch, it picks up where it left off — no re-processing images already done.
- You can pause a batch part-way through (a "Stop Processing" button) and resume it later, or abandon it and start a fresh upload instead — useful if you spot something that needs fixing before the rest finishes.
- Click any product photo on the review page to see it larger.
- It flags obvious problems itself (wrong length, sounds like a duplicate, still says "image of...") so reviewers know where to focus.

## Access

The tool is hosted at [menkind-alt-text-generator.fly.dev](https://menkind-alt-text-generator.fly.dev), protected by a shared username/password — ask a team member with access for the credentials.
