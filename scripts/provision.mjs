#!/usr/bin/env node
// Idempotent dev/prod provisioning for noomers Basin infrastructure.
// Usage: NOOMERS_CF_TOKEN_FILE=<path> node scripts/provision.mjs <env>
// Requires wrangler OAuth login for Workers/D1/Pipelines and the token
// file for Basin catalog/sink credentials.
import { execFileSync } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
    chmodSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const env = process.argv[2];
if (!["dev", "prod"].includes(env)) {
    console.error("usage: node scripts/provision.mjs <dev|prod>");
    process.exit(1);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = path.join(ROOT, "packages/server");
const ACCOUNT = "cf583c9be8982922212ed2e432115f57";
const TOKEN_FILE =
    process.env.NOOMERS_CF_TOKEN_FILE ||
    "/Users/harshil/.t3/userdata/secrets/files/f12258ac22590cbec22b8a83aba50656";
if (!existsSync(TOKEN_FILE)) {
    console.error(`token file missing: ${TOKEN_FILE}`);
    process.exit(1);
}
const TOKEN = readFileSync(TOKEN_FILE, "utf8").trim();

const names = {
    bucket: `noomers-${env}-events`,
    stream: `noomers_${env}_events`,
    sink: `noomers_${env}_sink`,
    pipeline: `noomers_${env}_pipeline`,
    d1: `noomers-${env}`,
    worker: env === "dev" ? "noomers-dev" : "noomers",
};

const W = path.join(SERVER, "node_modules/.bin/wrangler");
const wranglerBin = existsSync(W) ? W : "wrangler";

function redact(text) {
    return String(text).replaceAll(TOKEN, "<redacted>");
}

function run(args, { env: extraEnv = {}, capture = false } = {}) {
    console.log(redact(`$ wrangler ${args.join(" ")}`));
    try {
        const out = execFileSync(wranglerBin, args, {
            cwd: SERVER,
            env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT, ...extraEnv },
            encoding: "utf8",
            stdio: capture ? "pipe" : ["pipe", "inherit", "pipe"],
        });
        return capture ? out : "";
    } catch (e) {
        const stderr = e.stderr?.toString() || "";
        if (capture) throw e;
        if (/already exists|already in use|Conflict|409/i.test(stderr)) {
            console.log("  (exists — reusing)");
            return "";
        }
        console.error(redact(stderr));
        throw e;
    }
}
function tryRun(args, opts) {
    try {
        return run(args, opts);
    } catch (e) {
        const err = e.stderr?.toString() || e.stdout?.toString() || "";
        if (err) console.log("  tryRun error:", redact(err.slice(0, 300)));
        return "";
    }
}

// 1. R2 bucket + catalog + compaction
tryRun(["r2", "bucket", "create", names.bucket]);
tryRun(["r2", "bucket", "info", names.bucket]);
tryRun(["basin", "catalog", "enable", names.bucket], {
    env: { CLOUDFLARE_API_TOKEN: TOKEN },
});
tryRun(["basin", "catalog", "compaction", "enable", names.bucket], {
    env: { CLOUDFLARE_API_TOKEN: TOKEN },
});
// Snapshot expiration: keep snapshots younger than 7 days, retain last 10.
tryRun(
    [
        "basin", "catalog", "snapshot-expiration", "enable", names.bucket,
        "--older-than-days", "7",
        "--retain-last", "10",
        "--token", TOKEN,
    ],
);

// 2. Stream (schema file, HTTP ingest off)
tryRun(
    [
        "basin", "pipelines", "streams", "create", names.stream,
        "--schema-file", "pipelines/events.schema.json",
        "--http-enabled", "false",
    ],
);

const streamId = (() => {
    // `streams get` prints "Stream ID: <32-hex>" on success; try get first,
    // fall back to listing streams.
    for (const args of [
        ["basin", "pipelines", "streams", "get", names.stream],
        ["basin", "pipelines", "streams", "list"],
    ]) {
        try {
            const out = execFileSync(wranglerBin, args, {
                cwd: SERVER,
                env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT },
                encoding: "utf8",
                stdio: ["pipe", "pipe", "pipe"],
            });
            const m = /[0-9a-f]{32}/.exec(out);
            if (m) return m[0];
        } catch (e) {
            console.log(
                "  stream id lookup error:",
                redact((e.stderr?.toString() || "").slice(0, 200)),
            );
        }
    }
    return null;
})();
if (!streamId) throw new Error(`could not resolve stream id for ${names.stream}`);
console.log(`stream id: ${streamId}`);

// 3. Sink (r2-data-catalog)
tryRun(
    [
        "basin", "pipelines", "sinks", "create", names.sink,
        "--type", "r2-data-catalog",
        "--bucket", names.bucket,
        "--namespace", "noomers",
        "--table", "events",
        "--roll-interval", "60",
        "--compression", "zstd",
        "--catalog-token", TOKEN,
    ],
);

// 4. Pipeline
tryRun(
    [
        "basin", "pipelines", "create", names.pipeline,
        "--sql", `INSERT INTO ${names.sink} SELECT * FROM ${names.stream}`,
    ],
);

// 5. D1 + migrations
tryRun(["d1", "create", names.d1]);
let d1Id;
try {
    const out = tryRun(
        ["d1", "list", "--json"],
        { capture: true },
    );
    const list = JSON.parse(out || "[]");
    d1Id = list.find((d) => d.name === names.d1)?.uuid;
} catch {}
if (!d1Id) throw new Error(`could not resolve D1 id for ${names.d1}`);
console.log(`d1 id: ${d1Id}`);

// 6. wrangler.<env>.json
const base = JSON.parse(
    readFileSync(path.join(SERVER, "wrangler.json"), "utf8"),
);
const cfg = {
    ...base,
    name: names.worker,
    workers_dev: true,
    account_id: ACCOUNT,
    d1_databases: [
        {
            ...base.d1_databases[0],
            database_name: names.d1,
            database_id: d1Id,
        },
    ],
    pipelines: [{ binding: "EVENT_STREAM", stream: streamId }],
    vars: {
        ...(base.vars || {}),
        R2_SQL_BUCKET: names.bucket,
        R2_SQL_TABLE: "noomers.events",
        R2_SQL_IMPORT_TABLE: "noomers.events_import",
        CF_ACCOUNT_ID: ACCOUNT,
    },
};
const cfgPath = path.join(SERVER, `wrangler.${env}.json`);
writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
console.log(`wrote ${cfgPath}`);

// 7. Migrations (interactive confirm → pipe "y")
execFileSync(
    wranglerBin,
    ["d1", "migrations", "apply", names.d1, "--remote", "-c", cfgPath],
    {
        cwd: SERVER,
        env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT },
        input: "y\n",
        stdio: ["pipe", "inherit", "pipe"],
    },
);

// 8. Secrets (only if absent)
const credDir = path.join(os.homedir(), `.noomers-${env}`);
mkdirSync(credDir, { recursive: true, mode: 0o700 });
const credFile = path.join(credDir, "credentials");

const secretList = tryRun(
    ["secret", "list", "-c", cfgPath, "--format", "json"],
    { capture: true },
);
const existing = new Set(
    (JSON.parse(secretList || "[]") || []).map((s) => s.name),
);

function putSecret(name, value) {
    if (existing.has(name)) {
        console.log(`secret ${name}: already set`);
        return false;
    }
    execFileSync(wranglerBin, ["secret", "put", name, "-c", cfgPath], {
        cwd: SERVER,
        env: process.env,
        input: value,
        stdio: ["pipe", "inherit", "pipe"],
    });
    console.log(`secret ${name}: set`);
    return true;
}

const creds = existsSync(credFile)
    ? Object.fromEntries(
          readFileSync(credFile, "utf8")
              .split("\n")
              .filter((l) => l.includes("="))
              .map((l) => l.split("=", 2)),
      )
    : {};

if (!creds.dashboard_password)
    creds.dashboard_password = randomBytes(12).toString("base64url");
if (!creds.jwt_secret) creds.jwt_secret = randomBytes(32).toString("hex");
if (!creds.visitor_salt) creds.visitor_salt = randomBytes(16).toString("hex");
if (!creds.stats_token) creds.stats_token = randomBytes(24).toString("hex");
const { hashSync: bcryptHash } = await import(
    path.join(ROOT, "packages/cli/node_modules/bcryptjs/index.js")
);
const passwordHash = bcryptHash(creds.dashboard_password, 12);

putSecret("R2_SQL_TOKEN", TOKEN);
putSecret("CF_PASSWORD_HASH", passwordHash);
putSecret("CF_JWT_SECRET", creds.jwt_secret);
putSecret("VISITOR_SALT", creds.visitor_salt);
putSecret("STATS_API_TOKEN", creds.stats_token);
putSecret("SITES_API_TOKEN", creds.stats_token);

cfg.vars.CF_AUTH_ENABLED = "true";
writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

writeFileSync(
    credFile,
    `dashboard_password=${creds.dashboard_password}\njwt_secret=${creds.jwt_secret}\nvisitor_salt=${creds.visitor_salt}\nstats_token=${creds.stats_token}\n`,
    { mode: 0o600 },
);
chmodSync(credFile, 0o600);
console.log(`credentials written to ${credFile} (0600)`);
console.log("provisioning complete — deploy with scripts/deploy.mjs", env);
