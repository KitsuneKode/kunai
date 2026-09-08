import { describe, expect, test } from "bun:test";

import { classifyProviderHealth, parseSmokePayload } from "../../live/provider-matrix-report";

describe("parseSmokePayload", () => {
  test("reads a smoke that printed one JSON payload to stdout", () => {
    const payload = parseSmokePayload('{"ok":true,"provider":"vidlink"}', "");

    expect(payload).toEqual({ ok: true, provider: "vidlink" });
  });

  test("reads the provider payload when a smoke printed several JSON objects", () => {
    // The YouTube smoke prints its provider payload and then one object per
    // supplementary check. Concatenated objects are not a parseable document,
    // so a whole healthy provider used to be reported as a harness failure.
    const stdout = [
      '{"ok":true,"provider":"youtube","streamResolved":true}',
      '{"ok":true,"check":"quality-ladder","maxLadderHeight":2160}',
      '{"ok":true,"check":"type-short-search","resultCount":12}',
    ].join("\n");

    const payload = parseSmokePayload(stdout, "");

    expect(payload).toMatchObject({ ok: true, provider: "youtube", streamResolved: true });
  });

  test("reads a failure payload the smoke wrote to stderr", () => {
    // Early-exit failure paths report through console.error. Parsing stdout
    // alone turned a diagnosed provider failure into "no parseable JSON".
    const stderr = '{"ok":false,"stage":"search","reason":"anidb search returned zero results"}';

    const payload = parseSmokePayload("", stderr);

    expect(payload).toMatchObject({ ok: false, stage: "search" });
  });

  test("skips structured debug logging to reach the failure payload on stderr", () => {
    // Smokes run the container with debug logging, which prints its own JSON
    // to stderr ahead of the payload. Taking the first object found reported a
    // log line as the provider result, losing the reason entirely.
    const stderr = [
      '[2026-09-08T09:27:47.404Z] INFO: Container initialized {"providers":["anidb"],"capabilityIssues":0}',
      '{"ok":false,"stage":"search","reason":"anidb search returned zero results"}',
    ].join("\n");

    expect(parseSmokePayload("", stderr)).toMatchObject({
      ok: false,
      stage: "search",
      reason: "anidb search returned zero results",
    });
  });

  test("prefers the stdout payload when both streams carry JSON", () => {
    const payload = parseSmokePayload(
      '{"ok":true,"provider":"anidb"}',
      '{"ok":false,"log":"noise"}',
    );

    expect(payload).toMatchObject({ ok: true, provider: "anidb" });
  });

  test("ignores non-JSON log lines surrounding the payload", () => {
    const stdout = 'INFO: booted\n{"ok":true,"provider":"miruro"}\nINFO: done';

    expect(parseSmokePayload(stdout, "")).toMatchObject({ ok: true, provider: "miruro" });
  });

  test("returns null when neither stream carries JSON", () => {
    expect(parseSmokePayload("boom", "stack trace")).toBeNull();
  });
});

describe("classifyProviderHealth", () => {
  test("classifies a resolved provider as healthy", () => {
    expect(classifyProviderHealth({ ok: true, failureCodes: [] }, { timedOut: false })).toBe(
      "healthy",
    );
  });

  test("classifies an unparseable smoke as a harness failure", () => {
    expect(
      classifyProviderHealth({ ok: false, failureCodes: [] }, { timedOut: false, harness: true }),
    ).toBe("harness-failure");
  });

  test("classifies a diagnosed provider failure as drift, not a harness failure", () => {
    // A payload that names a reason is provider evidence. Reporting it as a
    // harness failure is what hid the AniDB outage behind "no parseable JSON".
    const result = { ok: false, failureCodes: [], reason: "search returned zero results" };

    expect(classifyProviderHealth(result, { timedOut: false })).toBe("provider-drift");
  });

  test("reads a stage/reason payload as evidence when there is no error field", () => {
    const result = { ok: false, failureCodes: [], reason: "upstream returned HTTP 503" };

    expect(classifyProviderHealth(result, { timedOut: false })).toBe("environment-network");
  });

  test("classifies a matrix deadline as an environment failure", () => {
    expect(classifyProviderHealth({ ok: false, failureCodes: [] }, { timedOut: true })).toBe(
      "environment-network",
    );
  });

  test("classifies an exhausted upstream route as provider drift", () => {
    const result = { ok: false, failureCodes: ["not-found"], error: "no playable source" };

    expect(classifyProviderHealth(result, { timedOut: false })).toBe("provider-drift");
  });
});
