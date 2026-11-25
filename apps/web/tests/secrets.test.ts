import { beforeAll, describe, test, expect } from "vite-plus/test";
import { env as testEnv } from "cloudflare:test";
import { secretsEqual } from "../worker/lib/secrets";
import { requireAPIKey } from "../worker/api/auth";
import { migrate } from "./helpers";

function requestWith(header?: string) {
  return new Request("http://localhost", {
    headers: header === undefined ? {} : { Authorization: header },
  });
}

describe("secretsEqual", () => {
  test("accepts identical strings", async () => {
    await expect(secretsEqual("secret-value", "secret-value")).resolves.toBe(true);
  });

  test("rejects a different string of the same length", async () => {
    await expect(secretsEqual("secret-value", "secret-valuf")).resolves.toBe(false);
  });

  test("rejects a different-length string", async () => {
    await expect(secretsEqual("secret-value", "secret")).resolves.toBe(false);
  });
});

describe("requireAPIKey", () => {
  beforeAll(migrate);

  const env = {
    ...testEnv,
    SITES_API_TOKEN: "sites-token",
    STATS_API_TOKEN: "stats-token",
  } as Env;

  test("accepts the sites token on the sites scope", async () => {
    const result = await requireAPIKey(requestWith("Bearer sites-token"), env, "sites");
    expect(result).toBeNull();
  });

  test("accepts the stats token on the sites scope", async () => {
    const result = await requireAPIKey(requestWith("Bearer stats-token"), env, "sites");
    expect(result).toBeNull();
  });

  test("accepts the stats token on the stats scope", async () => {
    const result = await requireAPIKey(requestWith("Bearer stats-token"), env, "stats");
    expect(result).toBeNull();
  });

  test("rejects the sites token on the stats scope", async () => {
    const result = await requireAPIKey(requestWith("Bearer sites-token"), env, "stats");
    expect(result?.status).toBe(401);
  });

  test("rejects a wrong token of the same length", async () => {
    const result = await requireAPIKey(requestWith("Bearer sites-tokem"), env, "sites");
    expect(result?.status).toBe(401);
  });

  test("rejects a token of a different length", async () => {
    const result = await requireAPIKey(requestWith("Bearer short"), env, "sites");
    expect(result?.status).toBe(401);
  });

  test("rejects a missing Authorization header", async () => {
    const result = await requireAPIKey(requestWith(), env, "sites");
    expect(result?.status).toBe(401);
  });

  test("rejects a malformed Authorization header", async () => {
    expect((await requireAPIKey(requestWith("Basic sites-token"), env, "sites"))?.status).toBe(401);
    expect((await requireAPIKey(requestWith("Bearersites-token"), env, "sites"))?.status).toBe(401);
  });

  test("empty env tokens never match an empty bearer token", async () => {
    const emptyEnv = { ...testEnv, SITES_API_TOKEN: "", STATS_API_TOKEN: "" } as Env;
    expect((await requireAPIKey(requestWith("Bearer "), emptyEnv, "sites"))?.status).toBe(401);
    expect((await requireAPIKey(requestWith("Bearer "), emptyEnv, "stats"))?.status).toBe(401);
    expect(
      (await requireAPIKey(requestWith("Bearer sites-token"), emptyEnv, "sites"))?.status,
    ).toBe(401);
  });

  test("rejects an unknown nmr_ key", async () => {
    const result = await requireAPIKey(requestWith("Bearer nmr_unknown"), env, "stats");
    expect(result?.status).toBe(401);
  });
});
