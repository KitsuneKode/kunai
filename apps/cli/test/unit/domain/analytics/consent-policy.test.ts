import { describe, expect, test } from "bun:test";

import {
  canPersistEnabled,
  canSend,
  envBlockFlag,
  isTruthyEnv,
  resolveConsentState,
} from "@/domain/analytics/consent-policy";

describe("isTruthyEnv", () => {
  test("only 1/true/yes are truthy, trimmed and case-insensitive", () => {
    for (const value of ["1", "true", "TRUE", " yes ", "Yes"]) {
      expect(isTruthyEnv(value)).toBe(true);
    }
    for (const value of [undefined, "", " ", "0", "false", "no", "off"]) {
      expect(isTruthyEnv(value)).toBe(false);
    }
  });
});

describe("envBlockFlag", () => {
  test("DO_NOT_TRACK=0 and CI=0 do not block", () => {
    expect(envBlockFlag({ DO_NOT_TRACK: "0", CI: "0" })).toBeNull();
    expect(envBlockFlag({ DO_NOT_TRACK: "false" })).toBeNull();
    expect(envBlockFlag({})).toBeNull();
  });

  test("truthy flags block, DO_NOT_TRACK named first", () => {
    expect(envBlockFlag({ DO_NOT_TRACK: "1" })).toBe("DO_NOT_TRACK");
    expect(envBlockFlag({ CI: "true" })).toBe("CI");
    expect(envBlockFlag({ DO_NOT_TRACK: "1", CI: "1" })).toBe("DO_NOT_TRACK");
  });
});

describe("resolveConsentState", () => {
  test("env block wins over a stored enabled preference", () => {
    expect(
      resolveConsentState({ env: { CI: "1" }, isInteractive: true, stored: "enabled" }),
    ).toEqual({ kind: "blocked-by-env", flag: "CI" });
  });

  test("unset without a TTY is undisclosed, not disabled", () => {
    expect(resolveConsentState({ env: {}, isInteractive: false, stored: "unset" })).toEqual({
      kind: "undisclosed-non-interactive",
    });
  });

  test("unset with a TTY awaits disclosure", () => {
    expect(resolveConsentState({ env: {}, isInteractive: true, stored: "unset" })).toEqual({
      kind: "awaiting-disclosure",
    });
  });

  test("stored preferences pass through when not env-blocked", () => {
    expect(resolveConsentState({ env: {}, isInteractive: true, stored: "enabled" })).toEqual({
      kind: "enabled",
    });
    expect(resolveConsentState({ env: {}, isInteractive: false, stored: "disabled" })).toEqual({
      kind: "disabled",
    });
  });

  test("CI=0 with stored enabled still sends — the regression this replaces", () => {
    const state = resolveConsentState({
      env: { CI: "0", DO_NOT_TRACK: "0" },
      isInteractive: true,
      stored: "enabled",
    });
    expect(state).toEqual({ kind: "enabled" });
    expect(canSend(state)).toBe(true);
  });
});

describe("canSend / canPersistEnabled", () => {
  test("only enabled may send", () => {
    expect(canSend({ kind: "enabled" })).toBe(true);
    for (const state of [
      { kind: "disabled" },
      { kind: "awaiting-disclosure" },
      { kind: "undisclosed-non-interactive" },
      { kind: "blocked-by-env", flag: "CI" },
    ] as const) {
      expect(canSend(state)).toBe(false);
    }
  });

  test("env block is the only bar to persisting enabled", () => {
    expect(canPersistEnabled({ kind: "awaiting-disclosure" })).toBe(true);
    expect(canPersistEnabled({ kind: "blocked-by-env", flag: "DO_NOT_TRACK" })).toBe(false);
  });
});
