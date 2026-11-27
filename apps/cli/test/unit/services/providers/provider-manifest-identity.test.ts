import { describe, expect, test } from "bun:test";

import { loadProductionProviderModules } from "@/container/bootstrap-providers";
import { createProviderFromModule } from "@/services/providers/Provider";

const roster = await loadProductionProviderModules({
  providerPriority: [],
  animeProviderPriority: [],
});

describe("production provider manifests · names", () => {
  test("no alias is shared, so every 'Known as' names exactly one provider", () => {
    // VidLink and VidRock both carried "P-Stream" — the shared engine family
    // (packages/providers/src/shared/direct-stream-source.ts), which neither
    // site is known by. A name two rows share identifies neither.
    const owners = new Map<string, string[]>();
    for (const { manifest } of roster) {
      for (const name of [manifest.displayName, ...(manifest.aliases ?? [])]) {
        const key = name.trim().toLowerCase();
        owners.set(key, [...(owners.get(key) ?? []), manifest.id]);
      }
    }
    const shared = [...owners].filter(([, ids]) => ids.length > 1);
    expect(shared).toEqual([]);
  });

  test("the engine family is not an alias of the providers built on it", () => {
    const byId = new Map(roster.map((module) => [module.providerId, module.manifest]));
    expect(byId.get("vidlink")?.aliases ?? []).toEqual([]);
    expect(byId.get("vidrock")?.aliases).toEqual(["Granite"]);
  });
});

describe("production provider manifests · known issue", () => {
  const declared = roster.filter((module) => module.manifest.knownIssue);

  test("the two providers the 2026-11-27 audit found broken declare it", () => {
    expect(declared.map((module) => module.providerId).sort()).toEqual(["videasy", "vidrock"]);
  });

  test("each claim is dated and reads as a clause in a picker row", () => {
    for (const { manifest } of declared) {
      const issue = manifest.knownIssue;
      expect(issue?.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isFinite(Date.parse(issue?.since ?? ""))).toBe(true);
      expect(issue?.summary).toMatch(/^[a-z].*[^.]$/);
      expect(issue?.summary.length).toBeLessThanOrEqual(40);
    }
  });

  test("the declaration reaches the metadata the picker reads", () => {
    for (const module of declared) {
      const { metadata } = createProviderFromModule(module, { mode: "series" });
      expect(metadata.knownIssue).toEqual(module.manifest.knownIssue);
    }
  });
});
