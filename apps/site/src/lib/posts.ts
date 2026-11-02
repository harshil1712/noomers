import { getCollection, type CollectionEntry } from "astro:content";

export type Post = CollectionEntry<"blog">;

/** Published posts, newest first. Drafts only in `astro dev`. */
export async function getPublishedPosts(): Promise<Post[]> {
  const posts = await getCollection("blog");
  return posts
    .filter((p: Post) => import.meta.env.DEV || !p.data.draft)
    .sort((a: Post, b: Post) => b.data.pubDate.getTime() - a.data.pubDate.getTime());
}

export async function getPublishedTags(): Promise<string[]> {
  const posts = await getPublishedPosts();
  return [...new Set(posts.flatMap((p) => p.data.tags))].sort((a, b) => a.localeCompare(b));
}
