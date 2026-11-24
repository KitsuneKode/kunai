import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  describeProfileLeak,
  diffProfile,
  realProfileRoots,
  realProfileTargets,
  snapshotProfile,
} from "../../helpers/profile-guard";
import { storageRootEnv } from "../../helpers/storage-env";

describe("profile guard", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kunai-profile-guard-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("an untouched profile produces no differences", () => {
    writeFileSync(join(dir, "config.json"), "{}");
    const before = snapshotProfile([dir]);
    expect(diffProfile(before, snapshotProfile([dir]))).toEqual([]);
  });

  test("a root that does not exist is an empty profile, and creating it is a difference", () => {
    const root = join(dir, "never-created");
    const before = snapshotProfile([root]);
    expect(before.size).toBe(0);

    mkdirSync(root);
    expect(existsSync(root)).toBe(true);
    // Creating the empty root is itself a lasting change.
    expect(diffProfile(before, snapshotProfile([root]))).toEqual([{ kind: "added", path: root }]);

    writeFileSync(join(root, "search-history.json"), "[]");
    expect(diffProfile(before, snapshotProfile([root]))).toEqual([
      { kind: "added", path: root },
      { kind: "added", path: join(root, "search-history.json") },
    ]);
  });

  test("snapshotting an absent profile creates nothing", () => {
    const root = join(dir, "absent");
    snapshotProfile([root], [join(root, "config.json"), join(root, "mpv", "kunai-bridge.lua")]);
    expect(existsSync(root)).toBe(false);
  });

  test("named files are watched even below the walk depth", () => {
    const deep = join(dir, "a", "b", "c", "d", "kunai-data.sqlite");
    mkdirSync(join(dir, "a", "b", "c", "d"), { recursive: true });
    writeFileSync(deep, "1");
    utimesSync(deep, new Date(2020, 0, 1), new Date(2020, 0, 1));
    const before = snapshotProfile([dir], [deep]);
    writeFileSync(deep, "2");
    expect(diffProfile(before, snapshotProfile([dir], [deep]))).toEqual([
      { kind: "changed", path: deep },
    ]);
  });

  test("reports added, removed and changed files, including a rewrite of the same size", () => {
    const kept = join(dir, "kept.json");
    const rewritten = join(dir, "rewritten.json");
    const removed = join(dir, "removed.json");
    writeFileSync(kept, "[1]");
    writeFileSync(rewritten, "[2]");
    writeFileSync(removed, "[3]");
    utimesSync(rewritten, new Date(2020, 0, 1), new Date(2020, 0, 1));
    const before = snapshotProfile([dir]);

    writeFileSync(rewritten, "[9]"); // same size, new mtime: how an idempotent rewrite shows up
    rmSync(removed);
    writeFileSync(join(dir, "added.json"), "[]");

    expect(diffProfile(before, snapshotProfile([dir]))).toEqual([
      { kind: "added", path: join(dir, "added.json") },
      { kind: "changed", path: rewritten },
      { kind: "removed", path: removed },
    ]);
  });

  test("looks inside nested directories", () => {
    mkdirSync(join(dir, "mpv"));
    const before = snapshotProfile([dir]);
    writeFileSync(join(dir, "mpv", "kunai-bridge.lua"), "-- bridge");
    expect(diffProfile(before, snapshotProfile([dir]))).toEqual([
      { kind: "added", path: join(dir, "mpv", "kunai-bridge.lua") },
    ]);
  });

  test("ignores per-playback temp metadata, so using Kunai during a run is not a leak", () => {
    // `chapters/` holds ffmetadata files the real app writes when playback starts and deletes when
    // it ends. A guard that flagged them would fire whenever the developer simply watched something.
    mkdirSync(join(dir, "chapters"));
    writeFileSync(join(dir, "chapters", "kunai-chapters-1.ffmeta"), ";FFMETADATA1");
    const before = snapshotProfile([dir]);

    writeFileSync(join(dir, "chapters", "kunai-chapters-2.ffmeta"), ";FFMETADATA1");
    rmSync(join(dir, "chapters", "kunai-chapters-1.ffmeta"));
    expect(diffProfile(before, snapshotProfile([dir]))).toEqual([]);

    // Anything else beside it is still watched.
    writeFileSync(join(dir, "search-history.json"), "[]");
    expect(diffProfile(before, snapshotProfile([dir]))).toEqual([
      { kind: "added", path: join(dir, "search-history.json") },
    ]);
  });

  test("resolves the profile roots from the environment it is given", () => {
    const roots = realProfileRoots(storageRootEnv(dir));
    // Linux collapses config, data and cache into one directory when every XDG variable is the same.
    expect(roots.length).toBeGreaterThanOrEqual(1);
    for (const root of roots) expect(root.startsWith(dir)).toBe(true);
  });

  test("names the config file, mpv bridge script and both databases", () => {
    const { files } = realProfileTargets(storageRootEnv(dir));
    const names = files.map((file) => file.slice(dir.length));
    expect(names.some((name) => name.endsWith("config.json"))).toBe(true);
    expect(names.some((name) => name.endsWith("kunai-bridge.lua"))).toBe(true);
    expect(names.some((name) => name.endsWith("kunai-data.sqlite"))).toBe(true);
    expect(names.some((name) => name.endsWith("kunai-cache.sqlite"))).toBe(true);
  });

  test("the failure message names the files and how to fix and skip it", () => {
    const message = describeProfileLeak([
      { kind: "changed", path: "/home/dev/.config/kunai/search-history.json" },
    ]);
    expect(message).toContain("/home/dev/.config/kunai/search-history.json");
    expect(message).toContain("applyStorageRootEnv");
    expect(message).toContain("KUNAI_TEST_SKIP_PROFILE_GUARD");
  });
});
