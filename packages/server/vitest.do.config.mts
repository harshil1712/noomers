import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
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
