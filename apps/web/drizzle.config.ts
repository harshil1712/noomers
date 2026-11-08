import { defineConfig } from "drizzle-kit";
export default defineConfig({ schema: "./schema/db.ts", out: "./migrations", dialect: "sqlite" });
