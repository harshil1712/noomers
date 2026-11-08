import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";
import { PROJECT } from "#project";

const blog = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/blog" }),
  schema: z
    .object({
      title: z.string().min(10).max(70),
      description: z.string().min(50).max(160),
      pubDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      author: z.string().default(`${PROJECT.productName} team`),
      tags: z.array(z.string()).default([]),
      draft: z.boolean().default(false),
      image: z.string().optional(),
      imageAlt: z.string().optional(),
      // Answer-first summary, rendered at the top of the post and reused for AEO.
      tldr: z.string().min(20),
      faq: z.array(z.object({ q: z.string(), a: z.string() })).optional(),
    })
    .refine((p) => !p.image || !!p.imageAlt, {
      message: "imageAlt is required when image is set",
      path: ["imageAlt"],
    }),
});

export const collections = { blog };
