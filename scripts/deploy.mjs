#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const env = process.argv[2];
if (!["dev", "prod"].includes(env)) {
    console.error("usage: node scripts/deploy.mjs <dev|prod>");
    process.exit(1);
}
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
execFileSync("pnpm", ["build"], { cwd: ROOT, stdio: "inherit" });
execFileSync(
    "wrangler",
    ["deploy", "-c", `packages/server/wrangler.${env}.json`],
    { cwd: path.join(ROOT, "packages/server"), stdio: "inherit" },
);
