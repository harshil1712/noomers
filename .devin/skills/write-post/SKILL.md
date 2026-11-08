---
name: write-post
description: Write a blog post for the Astro site (apps/site/src/content/blog/*.md). Use for any new or edited post — SEO/AEO structure, frontmatter rules and verification live here.
---

# Write a blog post

Posts are Markdown in git at `apps/site/src/content/blog/<slug>.md`, shipped by PR — no CMS. One post per PR.

## Slug

- Kebab-case, short, stable: `workers-rate-limiting.md`.
- **Never rename a published slug** — it breaks indexed URLs, RSS GUIDs and internal links. To change a URL, publish the new slug and leave a stub post that links to it (add a note in the PR description).

## Frontmatter (all enforced by `src/content.config.ts` — build fails otherwise)

```yaml
title: "10–70 chars, the real question or claim"        # required
description: "50–160 chars, becomes the meta description" # required
pubDate: 2026-10-30                                     # required
updatedDate: 2026-11-01                                 # set when materially editing
author: "noomers team"                                # default: product team
tags: ["cloudflare", "auth"]                            # kebab-case, reused for related posts
draft: true                                             # hidden from prod builds; check-dist fails if a draft slug leaks
image: /og-post.png                                     # optional; path in public/ or absolute URL
imageAlt: "what the image shows"                        # required iff image set
tldr: "1–2 sentences answering the post's question."    # required; rendered as TL;DR, used for AEO
faq:                                                    # optional; FAQ section + FAQPage JSON-LD
  - q: "A genuinely common question?"
    a: "A direct, self-contained answer."
```

## Structure (SEO/AEO)

- **Answer first**: `tldr` plus the first paragraph must answer the question in the title. An AI or snippet reader should get the whole answer in the first screen.
- **H2s phrased as questions people ask** ("What does the init script change?") — these surface as answer targets.
- Short paragraphs; concrete numbers, file paths, commands over adjectives.
- 1–3 internal links to other posts or site pages (`/blog/<slug>/`, `/privacy`, `/`) — check-dist fails on links to missing paths.
- `faq` only for genuinely common questions (2–4 max); answers must stand alone.
- Cite sources with links when referencing external facts.

## Style — no AI tells

Banned: "in today's fast-paced world", "it's not X, it's Y", "unlock", "seamless(ly)", "leverage", "elevate", "delve", "game-changer", rhetorical openers, em-dash-heavy filler, stacked synonyms. Write plainly; cut sentences that only repeat the title.

## Verify before the PR

1. `vp run -r test` from repo root — site test runs `astro build` + `scripts/check-dist.ts` (title/description/canonical/og:image, JSON-LD validity + BlogPosting/BreadcrumbList/FAQPage, draft leakage, rss/llms/sitemap presence, duplicate titles/descriptions, dead internal links).
2. Screenshot the post light + dark (`verify-ui` skill) — prose styles must be readable in both.
3. Check the rendered JSON-LD @graph in the page source if you touched frontmatter.

Editing a published post: bump `updatedDate`, keep the slug.
