import { describe, expect, test } from "bun:test";

import {
  addStremioAddon,
  findInstalledStremioAddon,
  isStremioAddonInstalled,
  MAX_STREMIO_ADDONS,
  normalizeStremioAddonEntries,
  readInstalledStremioAddons,
  removeStremioAddonFromConfig,
} from "@/domain/provider/stremio-addons";
import { DEFAULT_CONFIG, type KitsuneConfig } from "@kunai/config";

const A = "https://a.example.com/manifest.json";
const B = "https://b.example.com/manifest.json";

function idOf(url: string): string {
  const [addon] = readInstalledStremioAddons([{ url }]);
  if (!addon) throw new Error(`fixture ${url} did not parse`);
  return addon.providerId;
}

describe("stored addon list", () => {
  test("keeps valid entries and drops everything a hand edit could break", () => {
    const entries = normalizeStremioAddonEntries([
      { url: A, name: "  Alpha\n\u0007Addon  " },
      A,
      { url: "http://plain.example.com/manifest.json" },
      { url: "https://127.0.0.1/manifest.json" },
      { url: "https://c.example.com/" },
      { name: "no url" },
      null,
      7,
      B,
    ]);

    expect(entries).toEqual([{ url: A, name: "Alpha Addon" }, { url: B }]);
  });

  test("a value that is not a list is no addons", () => {
    expect(normalizeStremioAddonEntries(undefined)).toEqual([]);
    expect(normalizeStremioAddonEntries({ url: A })).toEqual([]);
    expect(normalizeStremioAddonEntries("nope")).toEqual([]);
  });

  test("a configured addon shows only its host, never a stored or remote name", () => {
    const configured = "https://a.example.com/key=CanaryToken/manifest.json";
    const [addon] = readInstalledStremioAddons([{ url: configured, name: "CanaryToken Addon" }]);

    expect(addon?.displayName).toBe("addon @ a.example.com");
    expect(addon?.entry.name).toBeUndefined();
    const added = addStremioAddon([], configured, "CanaryToken");
    expect(added.ok && added.entries).toEqual([{ url: configured }]);
  });

  test("an addon shows its own name when known, else its host", () => {
    const [named, unnamed] = readInstalledStremioAddons([{ url: A, name: "Alpha" }, { url: B }]);

    expect(named?.displayName).toBe("Alpha");
    expect(unnamed?.displayName).toBe("b.example.com");
  });

  test("the list is bounded", () => {
    const many = Array.from({ length: MAX_STREMIO_ADDONS + 5 }, (_, index) => ({
      url: `https://addon${index}.example.com/manifest.json`,
    }));

    expect(normalizeStremioAddonEntries(many)).toHaveLength(MAX_STREMIO_ADDONS);
  });
});

describe("adding and removing", () => {
  test("add appends; adding the same URL again only refreshes its name", () => {
    const first = addStremioAddon([], A);
    if (!first.ok) throw new Error(first.reason);
    const again = addStremioAddon(first.entries, ` ${A} `, "Alpha");
    if (!again.ok) throw new Error(again.reason);

    expect(first.added).toBe(true);
    expect(first.entries).toEqual([{ url: A }]);
    expect(again.added).toBe(false);
    expect(again.entries).toEqual([{ url: A, name: "Alpha" }]);
  });

  test("a recorded name survives a re-add that brings none", () => {
    const again = addStremioAddon([{ url: A, name: "Alpha" }], A);

    expect(again.ok && again.entries).toEqual([{ url: A, name: "Alpha" }]);
  });

  test("a bad URL and a full list are refused with a reason", () => {
    const full = Array.from({ length: MAX_STREMIO_ADDONS }, (_, index) => ({
      url: `https://addon${index}.example.com/manifest.json`,
    }));

    expect(addStremioAddon([], "http://a.example.com/manifest.json")).toMatchObject({ ok: false });
    expect(addStremioAddon(full, A)).toEqual({
      ok: false,
      reason: `Kunai keeps at most ${MAX_STREMIO_ADDONS} addons. Remove one first.`,
    });
  });

  test("an addon is found by number, id, URL, host or name; a shared host matches neither", () => {
    const installed = readInstalledStremioAddons([
      { url: A, name: "Alpha" },
      { url: B },
      { url: "https://a.example.com/token-other/manifest.json" },
    ]);
    const [alpha, beta] = installed;

    expect(findInstalledStremioAddon(installed, "2")).toBe(beta);
    expect(findInstalledStremioAddon(installed, alpha?.providerId ?? "")).toBe(alpha);
    expect(findInstalledStremioAddon(installed, A)).toBe(alpha);
    expect(findInstalledStremioAddon(installed, "B.example.com")).toBe(beta);
    expect(findInstalledStremioAddon(installed, "alpha")).toBe(alpha);
    expect(findInstalledStremioAddon(installed, "a.example.com")).toBe("ambiguous");
    expect(findInstalledStremioAddon(installed, "9")).toBeUndefined();
    expect(findInstalledStremioAddon(installed, "nothing")).toBeUndefined();
  });

  test("removing an addon removes every setting that names it", () => {
    const a = idOf(A);
    const b = idOf(B);
    const before: KitsuneConfig = {
      ...DEFAULT_CONFIG,
      stremioAddons: [{ url: A }, { url: B }],
      provider: a,
      providerPriority: [a, "vidlink", b],
      disabledProviders: [a, "movy"],
      titleProviderPreferences: { "tmdb:1": a, "tmdb:2": "vidlink" },
    };
    const next = removeStremioAddonFromConfig(before, a);

    expect(next.stremioAddons).toEqual([{ url: B }]);
    expect(next.provider).toBe("vidlink");
    expect(next.providerPriority).toEqual(["vidlink", b]);
    expect(next.disabledProviders).toEqual(["movy"]);
    expect(next.titleProviderPreferences).toEqual({ "tmdb:2": "vidlink" });
    expect(isStremioAddonInstalled(next.stremioAddons, a)).toBe(false);
    expect(isStremioAddonInstalled(next.stremioAddons, b)).toBe(true);
  });

  test("removing an addon that is not the default leaves the default alone", () => {
    const next = removeStremioAddonFromConfig(
      { ...DEFAULT_CONFIG, stremioAddons: [{ url: A }] },
      idOf(A),
    );

    expect(next.provider).toBe(DEFAULT_CONFIG.provider);
    expect(next.providerPriority).toEqual(DEFAULT_CONFIG.providerPriority);
  });
});
