import { describe, expect, test } from "bun:test";

import { describeServiceKeys } from "@/app-shell/panel-data";
import { keySettingsRows } from "@/app-shell/settings/registry/keys";
import { redactDiagnosticValue } from "@/services/diagnostics/redaction";

/** An unsigned `alg: none` JWT built at runtime from plain JSON: a shape, never a credential. */
function syntheticJwt(): string {
  const part = (json: string) => btoa(json).replaceAll("=", "");
  return [part('{"alg":"none"}'), part('{"test":1}'), "test"].join(".");
}

describe("service keys in /diagnostics and settings", () => {
  test("never prints a key, says where it came from, and warns when TMDB rejected it", () => {
    const yours = describeServiceKeys({
      tmdb: {
        active: { key: "secret-value", source: "user", kind: "bearer", origin: "settings" },
        userKeyRejected: false,
      },
      wyzieConfigured: true,
    });
    expect(yours.detail).toContain("TMDB: your read token (settings), direct to TMDB");
    expect(yours.detail).not.toContain("secret-value");
    expect(yours.tone).toBe("info");

    const rejected = describeServiceKeys({
      tmdb: {
        active: { key: "k", source: "legacy", kind: "api-key" },
        userKeyRejected: true,
      },
      wyzieConfigured: false,
    });
    expect(rejected.tone).toBe("warning");
    expect(rejected.detail).toContain("TMDB rejected your key (401)");
    expect(rejected.detail).toContain("no Wyzie key");
  });

  test("the TMDB key setting is masked and rejects text that is not a TMDB credential", () => {
    // SAFETY: keySettingsRows ignores its context; the rows depend on nothing in it.
    const row = keySettingsRows({} as never).find((entry) => entry.id === "tmdbApiKey");
    if (row?.kind !== "text") throw new Error("expected the tmdbApiKey text row");
    expect(row.sensitive).toBe(true);
    expect(row.validate("")).toBeNull();
    expect(row.validate("0123456789abcdef0123456789abcdef")).toBeNull();
    expect(row.validate(syntheticJwt())).toBeNull();
    expect(row.validate("not a key")).not.toBeNull();
  });

  test("diagnostics redact any field that ends like a credential", () => {
    expect(
      redactDiagnosticValue({
        tmdbApiKey: "a",
        wyzieApiKey: "b",
        someAccessToken: "c",
        poToken: "CLIENT.CONTEXT+TOKEN",
        ok: "d",
      }),
    ).toEqual({
      tmdbApiKey: "[redacted]",
      wyzieApiKey: "[redacted]",
      someAccessToken: "[redacted]",
      poToken: "[redacted]",
      ok: "d",
    });
  });
});
