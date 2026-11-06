import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { PROJECT } from "../../project.config.ts";
import { fileURLToPath } from "node:url";
import { readdirSync, readFileSync } from "node:fs";

// Post URL → lastmod, parsed from markdown frontmatter (sitemap's serialize
// has no access to content collections).
function postLastmods() {
  const dir = fileURLToPath(new URL("./src/content/blog/", import.meta.url));
  const map = {};
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".md")) continue;
    const fm = readFileSync(dir + f, "utf8").match(/^---\s*([\s\S]*?)\s*---/);
    if (!fm || /^draft:\s*true/m.test(fm[1])) continue;
    const date =
      fm[1].match(/^updatedDate:\s*(\S+)/m)?.[1] ?? fm[1].match(/^pubDate:\s*(\S+)/m)?.[1];
    if (date)
      map[`https://${PROJECT.domain}/blog/${f.slice(0, -3)}/`] = new Date(date).toISOString();
  }
  return map;
}
const lastmods = postLastmods();

export default defineConfig({
  site: `https://${PROJECT.domain}`,
  output: "static",
  integrations: [
    sitemap({
      serialize(item) {
        if (lastmods[item.url]) item.lastmod = lastmods[item.url];
        return item;
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        "#project": fileURLToPath(new URL("../../project.config.ts", import.meta.url)),
      },
    },
  },
});
