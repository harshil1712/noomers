/** Better Auth CLI config — used by `npm run auth:generate` to emit
 * src/auth-schema.ts (Drizzle). Uses a stub in-memory DB; keep the plugin
 * list in sync with worker/auth.ts. */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { admin } from "better-auth/plugins";
import { PRODUCT } from "./src/config";

const db = drizzle(new Database(":memory:"));

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "sqlite" }),
  baseURL: "http://localhost:5173",
  secret: "cli-placeholder-secret-at-least-32-characters-long",
  socialProviders: { google: { clientId: "x", clientSecret: "x" } },
  plugins: [admin()],
});
