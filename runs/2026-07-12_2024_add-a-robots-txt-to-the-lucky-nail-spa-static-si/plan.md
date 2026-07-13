## Plan

**Goal:** Add a minimal, standards-compliant `robots.txt` at the repo root that allows all crawlers to index everything, with no sitemap reference.

**Steps:**
1. Create `robots.txt` in the repo root with:
   ```
   User-agent: *
   Disallow:
   ```
   (An empty `Disallow` means nothing is disallowed — i.e., allow all — the standard idiom per the Robots Exclusion Protocol.)
2. Verify the file is at the root, is plain text, ends with a newline, and contains the `User-agent` directive.
3. Confirm `vercel.json` has no rewrite/redirect/header rule intercepting `/robots.txt` (checked — none do; static root files are served as-is by Vercel).
4. No other files need changes — this is a single static asset addition.

**Files to touch:**
- `robots.txt` (new file, repo root)

**Risks:**
- Low risk; single static text file, no build step involved.
- Must avoid accidentally writing `Disallow: /` (would block everything, opposite of intent).
- No sitemap line is included per task instructions, since the domain isn't configured in-repo.

## Validation commands
- test -f robots.txt && echo 'FILE EXISTS'
- grep -i '^User-agent:' robots.txt
- cat robots.txt
