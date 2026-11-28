import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createProfileInspector,
  diffSnapshots,
  snapshotProfile,
  type ProfileStoragePaths,
} from "../../agent/profile-inspector";

const roots: string[] = [];

function profileRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "kunai-profile-inspector-"));
  roots.push(root);
  return root;
}

function pathsFor(root: string): ProfileStoragePaths {
  return {
    dataDbPath: join(root, "data.sqlite"),
    cacheDbPath: join(root, "cache.sqlite"),
    configPath: join(root, "config.json"),
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("profile inspector config snapshots", () => {
  test("canonical config rows preserve nested objects while sorting their keys", () => {
    const root = profileRoot();
    const paths = pathsFor(root);
    writeFileSync(
      paths.configPath,
      JSON.stringify({
        providerRelay: { token: "before", enabled: true, baseUrl: "https://relay.example" },
        theme: "dark",
      }),
    );
    const before = snapshotProfile(paths);

    writeFileSync(
      paths.configPath,
      JSON.stringify({
        theme: "dark",
        providerRelay: { baseUrl: "https://relay.example", enabled: true, token: "after" },
      }),
    );
    const after = snapshotProfile(paths);

    const delta = diffSnapshots(before, after).get("config.json");
    expect(delta?.added.length).toBe(1);
    expect(delta?.removed.length).toBe(1);
    expect(delta?.added[0]).toContain('"token":"after"');
    expect(delta?.added[0]).toContain('"enabled":true');
  });

  test("a __proto__ key is kept as an ordinary property, so its changes are seen", () => {
    const root = profileRoot();
    const paths = pathsFor(root);
    writeFileSync(paths.configPath, '{"__proto__":{"enabled":false},"theme":"dark"}');
    const before = snapshotProfile(paths);
    writeFileSync(paths.configPath, '{"__proto__":{"enabled":true},"theme":"dark"}');
    const after = snapshotProfile(paths);

    const delta = diffSnapshots(before, after).get("config.json");
    expect(delta?.added.length).toBe(1);
    expect(delta?.added[0]).toContain('"__proto__":{"enabled":true}');
  });

  test("a config path that exists but cannot be read becomes the unreadable marker", () => {
    const root = profileRoot();
    const paths = pathsFor(root);
    mkdirSync(paths.configPath);

    expect(createProfileInspector(paths).config()).toEqual({ __unreadable: true });
    expect(snapshotProfile(paths).get("config.json")).toEqual(['{"__unreadable":true}']);
  });
});
