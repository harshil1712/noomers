#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const env = process.argv[2];
if (!["dev", "prod"].includes(env)) {
    console.error("usage: node scripts/deploy.mjs <dev|prod>");
    process.exit(1);
}
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = path.join(ROOT, "packages/server");
const W = path.join(SERVER, "node_modules/.bin/wrangler");
const wrangler = existsSync(W) ? W : "wrangler";
const ACCOUNT = "cf583c9be8982922212ed2e432115f57";

execFileSync("pnpm", ["build"], { cwd: ROOT, stdio: "inherit" });
execFileSync(wrangler, ["deploy", "-c", `wrangler.${env}.json`], {
    cwd: SERVER,
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT },
    stdio: "inherit",
});
