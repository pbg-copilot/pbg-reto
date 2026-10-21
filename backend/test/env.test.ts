import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env.js";

const base = { DATABASE_URL: "postgres://u:p@localhost:5439/reto" };

describe("AC-001.8 environment validation", () => {
  it("fails with a clear message that names the variable but never its value", () => {
    const secret = "sk-ant-super-secret-value";
    expect(() => loadEnv({ ANTHROPIC_API_KEY: secret, AI_PROVIDER: "anthropic" })).toThrowError(
      /DATABASE_URL/,
    );
    try {
      loadEnv({ ANTHROPIC_API_KEY: secret, PORT: "not-a-number" });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it("defaults to the fake AI provider when there is no API key", () => {
    expect(loadEnv(base).AI_PROVIDER).toBe("fake");
    expect(loadEnv({ ...base, ANTHROPIC_API_KEY: "x" }).AI_PROVIDER).toBe("anthropic");
  });

  it("requires a key when AI_PROVIDER=anthropic", () => {
    expect(() => loadEnv({ ...base, AI_PROVIDER: "anthropic" })).toThrowError(/ANTHROPIC_API_KEY/);
  });

  it("parses APP_ORIGIN as a list and rejects invalid session TTL", () => {
    const env = loadEnv({ ...base, APP_ORIGIN: "http://localhost:8088, http://localhost:5173" });
    expect(env.APP_ORIGIN).toEqual(["http://localhost:8088", "http://localhost:5173"]);
    expect(() => loadEnv({ ...base, SESSION_TTL_HOURS: "48" })).toThrowError(/SESSION_TTL_HOURS/);
  });
});
