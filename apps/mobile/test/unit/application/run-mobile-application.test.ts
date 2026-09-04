import { describe, expect, test } from "bun:test";

import { runMobileApplication } from "../../../src/application/run-mobile-application";
import { FakeMobileEnvironment } from "../../support/fake-mobile-environment";

const PROBE_URL = "https://probe.example/status?token=probe-secret";
const MEDIA_URL = "https://media.example/video.m3u8?token=media-secret";
const HOST_PROOF_ARGS = [
  "--host-proof",
  "--probe-url",
  PROBE_URL,
  "--media-url",
  MEDIA_URL,
] as const;

function run(fake: FakeMobileEnvironment, argv: readonly string[] = HOST_PROOF_ARGS) {
  return runMobileApplication({ argv, environment: fake.environment, version: "0.3.0-test" });
}

describe("runMobileApplication", () => {
  test("renders help and version without loading state or contacting adapters", async () => {
    for (const [argv, copy] of [
      [["--help"], "Usage: kunai-mobile"],
      [["--version"], "Kunai mobile 0.3.0-test"],
    ] as const) {
      const fake = new FakeMobileEnvironment();
      fake.loadError = new Error("state must not load");

      expect(await run(fake, argv)).toEqual({ code: 0, reason: "completed" });
      expect(fake.rendered.join("\n")).toContain(copy);
      expect(fake.httpRequests).toEqual([]);
      expect(fake.playerRequests).toEqual([]);
      expect(fake.committedStates).toEqual([]);
    }
  });

  test("returns an invalid-input exit without echoing rejected arguments", async () => {
    const fake = new FakeMobileEnvironment();
    const result = await run(fake, ["--unknown", MEDIA_URL]);

    expect(result).toEqual({ code: 2, reason: "invalid-input" });
    expect(fake.rendered.join("\n")).toContain("Invalid mobile command.");
    expect(fake.rendered.join("\n")).not.toContain(MEDIA_URL);
    expect(fake.httpRequests).toEqual([]);
  });

  test("names the rejected flag without echoing any value the tester typed", async () => {
    for (const [argv, reason] of [
      [["--host-proof", "--probe-url", PROBE_URL], "Missing --media-url"],
      [
        ["--host-proof", "--probe-url", "http://probe.example/status", "--media-url", MEDIA_URL],
        "--probe-url must be an absolute credential-free HTTPS URL",
      ],
      [["--host-proof", "--probe-url"], "Missing value for --probe-url"],
    ] as const) {
      const fake = new FakeMobileEnvironment();

      expect(await run(fake, argv)).toEqual({ code: 2, reason: "invalid-input" });
      const rendered = fake.rendered.join("\n");
      expect(rendered).toContain(reason);
      expect(rendered).toContain("Usage: kunai-mobile");
      for (const secret of ["probe-secret", "media-secret", "probe.example", "media.example"]) {
        expect(rendered).not.toContain(secret);
      }
    }
  });

  test("offers exactly one cancel option at the choice prompt", async () => {
    const fake = new FakeMobileEnvironment();
    fake.choices.push({ kind: "cancelled" });

    await run(fake);

    expect(fake.chooseRequests).toEqual([
      { prompt: "Continue?", choices: [{ value: "continue", label: "Run proof" }] },
    ]);
  });

  test("cancels before HTTP or player work and records one invocation", async () => {
    for (const choice of [
      { kind: "cancelled" } as const,
      { kind: "selected", value: "cancel" } as const,
    ]) {
      const fake = new FakeMobileEnvironment();
      fake.initialState = { schemaVersion: 1, hostProofRuns: 4 };
      fake.choices.push(choice);

      expect(await run(fake)).toEqual({ code: 0, reason: "cancelled" });
      expect(fake.httpRequests).toEqual([]);
      expect(fake.playerRequests).toEqual([]);
      expect(fake.committedStates).toEqual([
        { schemaVersion: 1, hostProofRuns: 5, lastResult: "cancelled" },
      ]);
    }
  });

  test("runs bounded HTTP then records only detached VLC handoff evidence", async () => {
    const fake = new FakeMobileEnvironment();
    fake.choices.push({ kind: "selected", value: "continue" });

    expect(await run(fake)).toEqual({ code: 0, reason: "handoff" });
    expect(fake.httpRequests).toEqual([
      { method: "GET", url: PROBE_URL, timeoutMs: 8_000, maxBytes: 65_536 },
    ]);
    expect(fake.playerRequests).toEqual([{ player: "vlc", url: MEDIA_URL }]);
    expect(fake.committedStates).toEqual([
      { schemaVersion: 1, hostProofRuns: 1, lastResult: "http-ok" },
      { schemaVersion: 1, hostProofRuns: 1, lastResult: "handoff-accepted" },
    ]);
    expect(JSON.stringify(fake.committedStates)).not.toContain("secret");
    expect(fake.rendered.join("\n")).toContain("handoff was accepted");
    expect(fake.rendered.join("\n")).not.toContain(PROBE_URL);
    expect(fake.rendered.join("\n")).not.toContain(MEDIA_URL);
  });

  test("fails closed on non-success or oversized HTTP without launching VLC", async () => {
    for (const response of [
      { status: 503, bytes: 12 },
      { status: 200, bytes: 65_537 },
    ]) {
      const fake = new FakeMobileEnvironment();
      fake.choices.push({ kind: "selected", value: "continue" });
      fake.httpResponse = response;

      expect(await run(fake)).toEqual({ code: 1, reason: "failed" });
      expect(fake.playerRequests).toEqual([]);
      expect(fake.committedStates.at(-1)).toEqual({
        schemaVersion: 1,
        hostProofRuns: 1,
        lastResult: "failed",
      });
      expect(fake.rendered.join("\n")).toContain("Mobile host proof failed.");
    }
  });

  test("records a fixed redacted failure when the player rejects handoff", async () => {
    const fake = new FakeMobileEnvironment();
    fake.choices.push({ kind: "selected", value: "continue" });
    fake.handoffResult = { kind: "rejected", reason: `bad ${MEDIA_URL}` };

    expect(await run(fake)).toEqual({ code: 1, reason: "failed" });
    expect(fake.committedStates.at(-1)).toEqual({
      schemaVersion: 1,
      hostProofRuns: 1,
      lastResult: "failed",
    });
    expect(fake.rendered.join("\n")).toContain("Mobile host proof failed.");
    expect(fake.rendered.join("\n")).not.toContain(MEDIA_URL);
  });

  test("does not overwrite state when loading it fails", async () => {
    const fake = new FakeMobileEnvironment();
    fake.loadError = new Error(`corrupt ${MEDIA_URL}`);

    expect(await run(fake)).toEqual({ code: 1, reason: "failed" });
    expect(fake.committedStates).toEqual([]);
    expect(fake.rendered.join("\n")).toEqual("Mobile host proof failed.");
  });

  test("still cancels when a port answers with an explicit cancel value", async () => {
    const fake = new FakeMobileEnvironment();
    fake.choices.push({ kind: "selected", value: "cancel" });

    expect(await run(fake)).toEqual({ code: 0, reason: "cancelled" });
    expect(fake.httpRequests).toEqual([]);
    expect(fake.playerRequests).toEqual([]);
  });
});
