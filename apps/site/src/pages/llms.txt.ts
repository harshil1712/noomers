import type { APIContext } from "astro";
import { getPublishedPosts } from "../lib/posts";
import { PROJECT } from "#project";

const SUMMARY = `${PROJECT.productName} is privacy-first, self-hosted web analytics for Cloudflare: a lightweight tracker, a realtime dashboard, and a Plausible-compatible API subset — all inside the owner\u2019s own Cloudflare account.`;

const PAGES: [string, string, string][] = [
  ["/", "Home", SUMMARY],
  ["/privacy", "Privacy policy", "How noomers handles visitor and account data."],
  ["/blog/", "Blog", `Notes and guides from the ${PROJECT.productName} team.`],
];

export async function GET(_context: APIContext) {
  const posts = await getPublishedPosts();
  const lines = [
    `# ${PROJECT.productName}`,
    "",
    `> ${SUMMARY}`,
    "",
    "## Pages",
    ...PAGES.map(
      ([path, title, desc]) => `- [${title}](https://${PROJECT.domain}${path}): ${desc}`,
    ),
    "",
    "## Blog",
    ...posts.map(
      (p) => `- [${p.data.title}](https://${PROJECT.domain}/blog/${p.id}/): ${p.data.description}`,
    ),
    "",
  ];
  return new Response(lines.join("\n"), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
