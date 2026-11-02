import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
// eslint-disable-next-line import/no-unresolved
import { defineConfig } from "vitest/config";

export default defineConfig({
    plugins: [
        cloudflareTest({
            wrangler: { configPath: "./wrangler.do-test.json" },
        }),
    ],
    test: {
        include: ["workers/__tests__/**/*.test.ts"],
    },
});
