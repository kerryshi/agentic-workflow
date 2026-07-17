## Goal
Add a valid `sitemap.xml` at the repo root listing the two public pages (`index.html` → `/`, `services.html` → `/services.html`) on the canonical domain `https://www.luckynailspadurham.com`, and add a `Sitemap:` line to `robots.txt`. No other files change.

Canonical domain derived from the `<link rel="canonical">` and `og:url` tags in both HTML files (unanimous; not present in robots.txt or vercel.json). URL forms mirror the pages' own canonical tags: `/` and `/services.html` (not the `/services` vercel rewrite).

## Ordered steps
1. Create `sitemap.xml` (UTF-8, no BOM) with `<?xml version="1.0" encoding="UTF-8"?>` and a `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` containing two `<url>` entries with `<loc>` values `https://www.luckynailspadurham.com/` and `https://www.luckynailspadurham.com/services.html`. Add optional `<lastmod>2026-07-15</lastmod>` (today's date from harness context) to each.
2. Append `Sitemap: https://www.luckynailspadurham.com/sitemap.xml` to `robots.txt`, preserving the existing CRLF line-ending convention (file currently ends at `Disallow:` with no trailing newline).
3. Run the validation commands below and confirm `git status --porcelain` shows only the two intended changes.

## Files to touch
- `sitemap.xml` (new)
- `robots.txt` (append one line)

## Validation commands
See validation_commands array.

## Risks
- **Line-ending drift in robots.txt** (CRLF, no trailing newline): a careless append could convert existing lines to LF and surface unintended whitespace diffs. Mitigation: preserve CRLF and inspect `git diff robots.txt`.
- **Wrong services URL**: must use `/services.html` (page's canonical) not `/services`. Confirmed against canonical tags.
- **BOM/encoding on sitemap.xml**: write plain UTF-8 without BOM so the XML parses cleanly.
