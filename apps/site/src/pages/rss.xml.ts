import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { getPublishedPosts } from "../lib/posts";
import { PROJECT } from "#project";

export async function GET(context: APIContext) {
  const posts = await getPublishedPosts();
  return rss({
    title: PROJECT.productName,
    description: `Notes and guides from the ${PROJECT.productName} team.`,
    site: context.site!,
    items: posts.map((p) => ({
      title: p.data.title,
      description: p.data.description,
      pubDate: p.data.pubDate,
      link: `/blog/${p.id}/`,
      categories: p.data.tags,
    })),
  });
}
