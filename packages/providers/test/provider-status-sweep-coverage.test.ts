import { describe, expect, test } from "bun:test";

import { SWEEP_EXEMPTIONS, SWEEP_PROBES } from "../scripts/provider-sweep-roster";
import { PRODUCTION_PROVIDER_IDS } from "../src/production";

/**
 * The status board once covered eight providers while production ran twelve —
 * the sweep kept its own hand-written roster and nobody noticed the drift.
 * Every production provider id must now be either probed or exempted with a
 * reason; adding a module without a fixture fails here instead of landing as
 * a silently missing row on the docs page.
 */
describe("provider status sweep coverage", () => {
  test("every production provider is swept or exempted", () => {
    const covered = new Set([
      ...SWEEP_PROBES.map((probe) => probe.id),
      ...Object.keys(SWEEP_EXEMPTIONS),
    ]);

    expect([...covered].sort()).toEqual([...PRODUCTION_PROVIDER_IDS].sort());
  });

  test("every exemption names a production provider and a reason", () => {
    for (const [providerId, reason] of Object.entries(SWEEP_EXEMPTIONS)) {
      expect(PRODUCTION_PROVIDER_IDS as readonly string[]).toContain(providerId);
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  test("every swept probe resolves through its own production module", () => {
    for (const probe of SWEEP_PROBES) {
      expect(probe.module.providerId).toBe(probe.id);
      expect(probe.frontDoor).toMatch(/^https:\/\//);
    }
  });
});
