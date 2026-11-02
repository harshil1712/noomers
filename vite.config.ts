import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: [
      "tooling/**",
      ".devin/**",
      ".agents/**",
      ".claude/**",
      "apps/site/.astro/**",
      "apps/site/dist/**",
      "**/routeTree.gen.ts",
      "apps/web/legacy-ui/**",
      "apps/web/tests/__port__/**",
      "packages/tracker/**",
    ],
  },
  lint: {
    ignorePatterns: [
      "tooling/**",
      ".devin/**",
      ".agents/**",
      ".claude/**",
      "apps/site/.astro/**",
      "apps/site/dist/**",
      "**/routeTree.gen.ts",
      "apps/web/legacy-ui/**",
      "apps/web/tests/__port__/**",
      "packages/tracker/**",
      // noomers analytics core — vendored code migrated unchanged;
      // exempt from anti-slop (raw SQL repositories are a documented
      // exception to the Drizzle rule too).
      "apps/web/worker/analytics/**",
      "apps/web/worker/sites/**",
      "apps/web/worker/goals/**",
      "apps/web/worker/custom-properties/**",
      "apps/web/worker/lib/**",
      "apps/web/worker/__testutils__/**",
      "apps/web/worker/site-events.ts",
      "apps/web/worker/realtime.ts",
      "apps/web/worker/readiness.ts",
      "apps/web/migrations/**",
      // Ported legacy test harnesses; new tests should still be clean.
      "apps/web/tests/**",
    ],
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      { name: "anti-slop", specifier: "./tooling/anti-slop/index.ts" },
    ],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      "anti-slop/no-array-filter-map": "error",
      "anti-slop/no-reduce-accumulator-copy": "error",
      "anti-slop/no-chained-type-assertions": "error",
      "anti-slop/no-conditional-empty-object-spread": "error",
      "anti-slop/no-known-value-widening": "error",
      "anti-slop/no-module-mocking": "error",
      "anti-slop/no-object-parameters": "error",
      "anti-slop/no-reflect-apply": "error",
      "anti-slop/no-reflect-get": "error",
      "anti-slop/no-runtime-typeof": "error",
      "anti-slop/no-shape-in-symbol-names": "error",
      "anti-slop/no-unknown-parameters": "error",
      "anti-slop/no-unknown-returns": "error",
      "anti-slop/no-unknown-type-aliases": "error",
      "anti-slop/no-unsafe-dictionary-type": "error",
      "anti-slop/no-widen-then-assert": "error",
    },
    options: { typeAware: true, typeCheck: true },
  },
});
