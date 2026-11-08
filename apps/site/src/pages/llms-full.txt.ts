import type { APIContext } from "astro";
import { getPublishedPosts } from "../lib/posts";

export async function GET(_context: APIContext) {
  const posts = await getPublishedPosts();
  const body = posts
    .map(
      (p) =>
        `# ${p.data.title}\n\nURL: /blog/${p.id}/\nPublished: ${p.data.pubDate.toISOString().slice(0, 10)}\n\n${p.body}\n`,
    )
    .join("\n---\n\n");
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
