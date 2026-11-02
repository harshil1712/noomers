// vitest.config.ts
import { defineConfig, coverageConfigDefaults, configDefaults } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
    test: {
        pool: 'forks', // Forces process isolation
        exclude: [...configDefaults.exclude, "workers/__tests__/**"],
        coverage: {
            provider: "v8", // or 'v8'
            exclude: [
                "build",
                "tailwind.config.ts",
                "public/tracker.js",
                ...coverageConfigDefaults.exclude,
            ],
        },
    },
    plugins: [tsconfigPaths()],
});
