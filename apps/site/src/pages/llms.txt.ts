import type { APIContext } from "astro";
import { getPublishedPosts } from "../lib/posts";
import { APP_DOMAIN, PROJECT } from "#project";

const SUMMARY = `${PROJECT.productName} is a full-stack SaaS template for Cloudflare: auth, a D1 database, an admin area, a marketing site with a blog, and deploys included.`;

const PAGES: [string, string, string][] = [
  ["/", "Home", SUMMARY],
  ["/privacy", "Privacy policy", "What data the site and app collect, and why."],
  ["/blog/", "Blog", `Notes and guides from the ${PROJECT.productName} team.`],
];

export async function GET(_context: APIContext) {
  const posts = await getPublishedPosts();
  const app = `https://${APP_DOMAIN}`;
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
    ...(PROJECT.api.publicSpec
      ? [
          "## For agents",
          `- [OpenAPI 3.1 document](${app}/api/v1/openapi.json): the typed /api/v1 surface. Auth is \`Authorization: Bearer <API key>\` — mint one in Settings → API keys.`,
          `- [MCP server (Streamable HTTP)](${app}/mcp): the same operations as MCP tools. Auth is \`Authorization: Bearer <API key>\` — mint one in Settings → API keys.`,
          "",
        ]
      : []),
  ];
  return new Response(lines.join("\n"), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
