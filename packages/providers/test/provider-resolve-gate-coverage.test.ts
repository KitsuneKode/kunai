import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every production provider must prove a stream is playable before reporting
 * success, and must do it through the shared gate.
 *
 * This rule is not decorative. Rivestream reported `provider:success` for a
 * playlist whose segments answered `domain forbidden`, and cycling stopped
 * there instead of reaching a server that plays. Videasy verified a stream with
 * one Origin and shipped it with another, so its gate attested a request shape
 * production never made. Both were invisible until someone ran mpv by hand.
 *
 * Going through `verifyCandidateStream` is what makes the probed request and
 * the shipped request the same object; a provider that assembles its own probe
 * can drift apart again, which is exactly how the Videasy bug happened.
 */
const PROVIDER_SRC = join(import.meta.dir, "../src");

/** Providers registered by `loadProductionProviderModules()`. */
const PRODUCTION_PROVIDERS = [
  "videasy",
  "vidlink",
  "rivestream",
  "allmanga",
  "anidb",
  "miruro",
  "youtube",
] as const;

/**
 * A provider may only appear here with a reason that is about the *runtime*,
 * not about effort.
 */
const EXEMPT: Partial<Record<(typeof PRODUCTION_PROVIDERS)[number], string>> = {
  // YouTube hands mpv a watch URL and lets ytdl resolve the media at play time.
  // There is no direct stream URL at resolve time to probe, and the smoke
  // asserts the watch-host contract instead.
  youtube: "resolves through mpv/ytdl, not a direct stream URL",
  // Miruro's per-candidate budget is 4.8-5s once `providerCycleCandidateTimeoutMs`
  // clamps it against the attempt budget, and that has to cover its pipe call as
  // well. A three-hop HLS probe costs 2.1-2.9s, so a gate here would routinely be
  // cut short, report `timeout`, and pass everything — a gate that cannot reach a
  // verdict is worse than none, because it reads as coverage. Raising the budget
  // needs a live provider to measure against, and Miruro is WAF-blocked; tracked
  // in .plans/provider-playback-resilience.md.
  miruro: "per-candidate budget cannot contain a probe; needs a budget rework measured live",
};

/** Either the gate itself, or the shared direct-stream engine that calls it. */
const GATE_MARKERS = ["verifyCandidateStream", "resolveDirectStreamSource"];

function providerSources(provider: string): string {
  const dir = join(PROVIDER_SRC, provider);
  return readdirSync(dir)
    .filter((file) => file.endsWith(".ts"))
    .map((file) => readFileSync(join(dir, file), "utf8"))
    .join("\n");
}

describe("resolve gate coverage", () => {
  test.each(PRODUCTION_PROVIDERS.filter((provider) => !(provider in EXEMPT)))(
    "%s verifies a stream before reporting success",
    (provider) => {
      const source = providerSources(provider);

      expect(GATE_MARKERS.some((marker) => source.includes(marker))).toBe(true);
    },
  );

  test("every exemption states a runtime reason", () => {
    for (const [provider, reason] of Object.entries(EXEMPT)) {
      expect(PRODUCTION_PROVIDERS).toContain(provider as (typeof PRODUCTION_PROVIDERS)[number]);
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  test("the shared gate is the only place a resolve-gate probe is built", () => {
    // A provider that calls `runStreamHealthCheck({ phase: "resolve-gate" })`
    // directly is assembling its own probe again, which is what let the probed
    // and shipped request shapes diverge.
    const offenders: string[] = [];
    for (const provider of PRODUCTION_PROVIDERS) {
      const source = providerSources(provider);
      if (/phase:\s*"resolve-gate"/.test(source)) offenders.push(provider);
    }

    expect(offenders).toEqual([]);
  });
});
