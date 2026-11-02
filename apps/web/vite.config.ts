import { defineConfig, lazyPlugins } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";

// Test-only: applied to the shared test D1 in tests via
// `applyD1Migrations(env.DB, env.TEST_MIGRATIONS)` — proves the hand-written
// migrations apply unmodified, exactly as alchemy will apply them.
const testMigrations = process.env.VITEST ? await readD1Migrations("./migrations") : [];

export default defineConfig({
  staged: { "*": "vp check --fix" },
  fmt: { ignorePatterns: ["src/routeTree.gen.ts", "legacy-ui/**", "tests/__port__/**"] },
  lint: {
    ignorePatterns: ["src/routeTree.gen.ts", "legacy-ui/**", "tests/__port__/**"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  test: {
    include: ["tests/**/*.test.ts", "worker/**/__tests__/**/*.test.ts"],
    exclude: ["tests/__port__/**"],
    testTimeout: 30_000,
    // Better Auth signals redirects/403s by throwing APIError inside its
    // endpoint machinery on a separate task — the worker answers correctly,
    // but vitest counts the cross-task rejection as unhandled and fails the
    // suite nondeterministically. Filter only those APIErrors (name +
    // control-flow status codes); every other unhandled error still fails.
    onUnhandledError: (error) => {
      const e = error as { name?: string; statusCode?: number };
      if (
        e.name === "APIError" &&
        (e.statusCode === 302 ||
          e.statusCode === 403 ||
          e.statusCode === 400 ||
          e.statusCode === 404)
      ) {
        return false;
      }
    },
  },
  plugins: [
    lazyPlugins(() => [
      tanstackRouter({ target: "react", autoCodeSplitting: true }),
      react(),
      tailwindcss(),
    ]),
    // Test-only: cloudflareTest switches resolve conditions to workerd,
    // which makes the browser app resolve server builds. Load it only
    // under Vitest.
    !!process.env.VITEST &&
      cloudflareTest({
        wrangler: { configPath: "./vitest.wrangler.jsonc" },
        miniflare: {
          bindings: { TEST_MIGRATIONS: testMigrations },
          serviceBindings: { EMAIL_SINK: "email-sink" },
          workers: [
            {
              name: "email-sink",
              modules: true,
              compatibilityDate: "2025-06-01",
              // Records outbound mail into the shared test D1 so tests can
              // assert a verification/reset email was actually sent.
              d1Databases: { DB: "test-db" },
              script: `export default { async fetch(req, env) {
                const m = await req.json();
                await env.DB.prepare(
                  "CREATE TABLE IF NOT EXISTS sent_email (to_addr text, subject text, text text, html text)"
                ).run();
                await env.DB.prepare("INSERT INTO sent_email VALUES (?,?,?,?)")
                  .bind(m.to, m.subject, m.text, m.html).run();
                return new Response("ok");
              }}`,
            },
          ],
        },
      }),
  ],
});
