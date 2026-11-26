import { describe, expect, test } from "bun:test";

import { rebaseNestedPatch, settingsDraftPatch } from "@/app-shell/settings/persist";
import {
  applyLeafPaths,
  changedLeafPaths,
  DirtyConfigLeaves,
} from "@/services/persistence/config-leaf-merge";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";

describe("config leaf merge", () => {
  test("names only the leaves that changed, treating arrays as one leaf", () => {
    expect(
      changedLeafPaths(
        { a: { b: 1, c: [1, 2] }, d: "x" },
        { a: { b: 1, c: [1, 3] }, d: "x", e: true },
      ),
    ).toEqual([["a", "c"], ["e"]]);
    expect(changedLeafPaths({ a: 1 }, { a: 1 })).toEqual([]);
  });

  test("replays leaves onto a newer base without mutating either input", () => {
    const base = { anilist: { enabled: true, trackWatched: true }, pausedUntil: "later" };
    const source = { anilist: { enabled: false, trackWatched: false } };

    const merged = applyLeafPaths(base, source, [["anilist", "enabled"], ["pausedUntil"]]);

    // trackWatched keeps the base's newer value; a leaf the source dropped is removed.
    expect(merged).toEqual({ anilist: { enabled: false, trackWatched: true } });
    expect(base.anilist.enabled).toBe(true);
  });

  type Doc = {
    readonly sync: { readonly a: number; readonly b: number };
    readonly providerRelay: { readonly token: string; readonly baseUrl: string };
  };

  test("keys owning a vaulted secret always persist whole", () => {
    const leaves = new DirtyConfigLeaves<Doc>(new Set<keyof Doc>(["providerRelay"]));
    leaves.record("providerRelay", { token: "a", baseUrl: "" }, { token: "a", baseUrl: "x" });
    leaves.record("sync", { a: 1, b: 1 }, { a: 2, b: 1 });

    expect(leaves.isLeafMerged("providerRelay")).toBe(false);
    expect(leaves.persistedValue("sync", { a: 2, b: 1 }, { a: 1, b: 9 })).toEqual({ a: 2, b: 9 });
  });

  test("a whole-marked key stays whole after later leaf edits", () => {
    const leaves = new DirtyConfigLeaves<Doc>(new Set());
    leaves.markWhole("sync");
    leaves.record("sync", { a: 1, b: 0 }, { a: 2, b: 0 });

    expect(leaves.isLeafMerged("sync")).toBe(false);
  });
});

describe("Settings draft rebase", () => {
  /**
   * In one process: Settings opens (draft = snapshot), a tracker connect turns
   * sync on underneath it, then the user pauses sync. The draft's whole `sync`
   * still says disabled; only the pause may reach config.
   */
  test("a stale draft's nested key carries only the user's leaf", () => {
    const opened: KitsuneConfig = structuredClone(DEFAULT_CONFIG);
    const live: KitsuneConfig = {
      ...opened,
      sync: { ...opened.sync, anilist: { ...opened.sync.anilist, enabled: true } },
    };
    const edited: KitsuneConfig = {
      ...opened,
      sync: { ...opened.sync, pausedUntil: "2099-01-01T00:00:00.000Z" },
    };

    const patch = rebaseNestedPatch(settingsDraftPatch(edited, opened), opened, live);

    expect(patch.sync?.anilist.enabled).toBe(true);
    expect(patch.sync?.pausedUntil).toBe("2099-01-01T00:00:00.000Z");
  });

  test("flat keys pass through untouched", () => {
    const opened: KitsuneConfig = structuredClone(DEFAULT_CONFIG);
    const edited: KitsuneConfig = { ...opened, theme: "light" };

    expect(rebaseNestedPatch(settingsDraftPatch(edited, opened), opened, opened)).toEqual({
      theme: "light",
    });
  });
});
