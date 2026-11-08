/**
 * SEO regression check over dist/. Fails loudly so agent-written posts can't
 * silently break SEO. Run via `astro build && vpx scripts/check-dist.ts`.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const DIST = new URL("../dist/", import.meta.url).pathname;
const failures: string[] = [];
const fail = (file: string, msg: string) => failures.push(`${file}: ${msg}`);

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}
const files = [...walk(DIST)];
const htmlFiles = files.filter((f) => f.endsWith(".html"));
const rel = (f: string) => relative(DIST, f);
const read = (f: string) => readFileSync(f, "utf8");

// collect every emitted path for internal-link checks
const emitted = new Set(
  htmlFiles.map(
    (f) =>
      "/" +
      rel(f)
        .replace(/index\.html$/, "")
        .replace(/\.html$/, "/"),
  ),
);
emitted.add("/");

const titles = new Map<string, string[]>();
const descs = new Map<string, string[]>();

for (const f of htmlFiles) {
  const r = rel(f);
  const html = read(f);
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1];
  if (!title) fail(r, "missing <title>");
  else titles.set(title, [...(titles.get(title) ?? []), r]);
  const desc = html.match(/<meta name="description" content="([^"]*)"/)?.[1];
  if (!desc) fail(r, "missing meta description");
  else descs.set(desc, [...(descs.get(desc) ?? []), r]);
  if (!/<link rel="canonical"/.test(html)) fail(r, "missing canonical");
  if (!/<meta property="og:image"/.test(html)) fail(r, "missing og:image");
  if (!/<meta name="description"/.test(html)) fail(r, "no meta description tag at all");

  // JSON-LD must be valid JSON
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const parsed = JSON.parse(m[1]);
      const types = JSON.stringify(parsed);
      if (r.startsWith("blog/") && r !== "blog/index.html" && !r.includes("tags")) {
        if (!types.includes('"BlogPosting"')) fail(r, "post missing BlogPosting JSON-LD");
        if (!types.includes('"BreadcrumbList"')) fail(r, "post missing BreadcrumbList JSON-LD");
      }
      // h2 may carry Astro's scoped-style attribute (data-astro-cid-*)
      if (/<section[^>]*>\s*<h2[^>]*>FAQ<\/h2>/.test(html) && !types.includes('"FAQPage"'))
        fail(r, "has FAQ section but no FAQPage JSON-LD");
    } catch {
      fail(r, "invalid JSON in ld+json block");
    }
  }

  // internal links → emitted paths
  for (const m of html.matchAll(/href="(\/[^"#]*)"/g)) {
    const path = m[1];
    if (path.startsWith("//") || /\.(svg|png|css|js|woff2?|txt|xml|ico)$/.test(path)) continue;
    const norm = path.endsWith("/") ? path : path + "/";
    if (!emitted.has(norm) && !emitted.has(path)) fail(r, `internal link to missing path ${path}`);
  }
}

// duplicate titles / descriptions across pages
for (const [t, files] of titles)
  if (files.length > 1) fail(files.join(", "), `duplicate <title> "${t}"`);
for (const [d, files] of descs)
  if (files.length > 1) fail(files.join(", "), `duplicate description "${d.slice(0, 60)}…"`);

// required files
for (const req of [
  "rss.xml",
  "llms.txt",
  "llms-full.txt",
  "sitemap-index.xml",
  "robots.txt",
  "blog/index.html",
])
  if (!existsSync(join(DIST, req))) fail(req, "required file missing from dist");

// sitemap: every published post URL must carry <lastmod>
const sitemapFile = files.find((f) => /sitemap-\d+\.xml$/.test(f));
if (sitemapFile) {
  const sm = read(sitemapFile);
  for (const m of sm.matchAll(/<url>[\s\S]*?<\/url>/g)) {
    if (/blog\/[a-z0-9-]+\//.test(m[0]) && !m[0].includes("/tags/") && !/<lastmod>/.test(m[0])) {
      fail("sitemap", `post URL missing <lastmod>: ${m[0].match(/<loc>([^<]*)/)?.[1]}`);
    }
  }
}
// Organization logo URL must resolve to a real asset
const home = read(join(DIST, "index.html"));
const logoUrl = home.match(/"logo":\s*"[^"]*\/([^/"]+)"/)?.[1];
if (logoUrl && !existsSync(join(DIST, logoUrl)))
  fail("index.html", `Organization logo ${logoUrl} missing from dist`);

// drafts must not appear anywhere
const drafts = readdirSync(join(new URL("../src/content/blog/", import.meta.url).pathname))
  .filter((f) => f.endsWith(".md"))
  .filter((f) =>
    /^draft:\s*true/m.test(
      readFileSync(join(new URL("../src/content/blog/", import.meta.url).pathname, f), "utf8"),
    ),
  )
  .map((f) => f.slice(0, -3));
if (drafts.length) {
  for (const f of files) {
    if (["sitemap-index.xml", "sitemap-0.xml"].includes(rel(f)) && !read(f).includes("blog"))
      continue;
    for (const d of drafts) if (read(f).includes(d)) fail(rel(f), `contains draft slug "${d}"`);
  }
}

if (failures.length) {
  console.error(`check-dist: ${failures.length} failure(s)`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log(`check-dist: ok (${htmlFiles.length} pages, ${files.length} files)`);
