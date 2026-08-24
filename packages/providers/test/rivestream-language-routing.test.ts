import { describe, expect, test } from "bun:test";

import { buildRivestreamCycleCandidates } from "../src/rivestream/direct";

// The live discovery list as returned by rivestream.app (2026-08-24), not the
// stale static fallback — routing must hold against what production actually
// cycles through.
const SERVICES = [
  "apex",
  "pulse",
  "solstice",
  "quasar",
  "horizon",
  "primevids",
  "flowcast",
  "asiacloud",
  "citadel",
  "hindicast",
  "guru",
] as const;

function orderOf(preferredAudioLanguage?: string, preferredSourceId?: string): string[] {
  return [...buildRivestreamCycleCandidates(SERVICES, preferredSourceId, preferredAudioLanguage)]
    .sort((a, b) => a.priority - b.priority)
    .map((candidate) => String(candidate.serverId));
}

describe("rivestream language routing", () => {
  test("a Hindi request promotes the Hindi mirror ahead of discovery order", () => {
    expect(orderOf("hi")[0]).toBe("hindicast");
  });

  test("discovery order is preserved when no language is requested", () => {
    expect(orderOf()).toEqual([...SERVICES]);
    // "original" is not an ISO code and must not be treated as one.
    expect(orderOf("original")).toEqual([...SERVICES]);
  });

  test("an explicitly pinned source outranks the language match", () => {
    const pinned = buildRivestreamCycleCandidates(SERVICES, undefined, "hi").find(
      (candidate) => candidate.serverId === "guru",
    );
    const order = orderOf("hi", pinned?.sourceId);
    expect(order[0]).toBe("guru");
    expect(order[1]).toBe("hindicast");
  });

  test("an unmatched language leaves the cycle untouched", () => {
    expect(orderOf("ja")).toEqual([...SERVICES]);
  });
});
