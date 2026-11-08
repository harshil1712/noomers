import { describe, test, expect } from "vite-plus/test";
import { secretsEqual } from "../worker/lib/secrets";
import { requireAPIKey } from "../worker/api/auth";

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
  const env = { SITES_API_TOKEN: "correct-token" } as Env;

  function requestWith(header?: string) {
    return new Request("http://localhost", {
      headers: header === undefined ? {} : { Authorization: header },
    });
  }

  test("accepts the correct bearer token", async () => {
    const result = await requireAPIKey(requestWith("Bearer correct-token"), env);
    expect(result).toBeNull();
  });

  test("rejects a wrong token of the same length", async () => {
    const result = await requireAPIKey(requestWith("Bearer correct-tokem"), env);
    expect(result?.status).toBe(401);
  });

  test("rejects a token of a different length", async () => {
    const result = await requireAPIKey(requestWith("Bearer short"), env);
    expect(result?.status).toBe(401);
  });

  test("rejects a missing Authorization header", async () => {
    const result = await requireAPIKey(requestWith(), env);
    expect(result?.status).toBe(401);
  });

  test("rejects when the configured token is empty", async () => {
    const emptyEnv = { SITES_API_TOKEN: "" } as Env;
    const result = await requireAPIKey(requestWith("Bearer "), emptyEnv);
    expect(result?.status).toBe(401);
  });
});
