import { describe, expect, test } from "bun:test";

import {
  createBunStateStore,
  type AndroidStateRuntime,
} from "../../../../src/runtime/android/bun-state-store";

function fakeRuntime(initial: Readonly<Record<string, string>> = {}): {
  readonly files: Map<string, string>;
  readonly moves: [string, string][];
  failMoveFrom?: string;
  readonly runtime: AndroidStateRuntime;
} {
  const result = {
    files: new Map(Object.entries(initial)),
    moves: [] as [string, string][],
    failMoveFrom: undefined as string | undefined,
    runtime: {} as AndroidStateRuntime,
  };
  result.runtime = {
    ensureDirectory: async () => {},
    readText: async (path) => result.files.get(path),
    writeText: async (path, value) => {
      result.files.set(path, value);
    },
    remove: async (path) => {
      result.files.delete(path);
    },
    move: async (from, to) => {
      result.moves.push([from, to]);
      if (from === result.failMoveFrom) throw new Error("move failed");
      const value = result.files.get(from);
      if (value === undefined) throw new Error("source missing");
      result.files.delete(from);
      result.files.set(to, value);
    },
  };
  return result;
}

describe("Bun Android state store", () => {
  test("loads a default only when the state file is missing", async () => {
    const fake = fakeRuntime();
    const store = createBunStateStore({ root: "/sandbox", runtime: fake.runtime });

    await expect(store.load()).resolves.toEqual({ schemaVersion: 1, hostProofRuns: 0 });
    fake.files.set("/sandbox/mobile-state.json", "not json");
    await expect(store.load()).rejects.toThrow("Invalid mobile state");
  });

  test("writes and validates a temporary file before atomic activation", async () => {
    const fake = fakeRuntime();
    const store = createBunStateStore({ root: "/sandbox", runtime: fake.runtime });

    await store.commit({ schemaVersion: 1, hostProofRuns: 1, lastResult: "http-ok" });

    expect(fake.moves).toContainEqual([
      "/sandbox/mobile-state.json.tmp",
      "/sandbox/mobile-state.json",
    ]);
    await expect(store.load()).resolves.toEqual({
      schemaVersion: 1,
      hostProofRuns: 1,
      lastResult: "http-ok",
    });
  });

  test("restores the prior valid state when final activation fails", async () => {
    const currentPath = "/sandbox/mobile-state.json";
    const temporaryPath = `${currentPath}.tmp`;
    const previous = JSON.stringify({ schemaVersion: 1, hostProofRuns: 4 });
    const fake = fakeRuntime({ [currentPath]: previous });
    fake.failMoveFrom = temporaryPath;
    const store = createBunStateStore({ root: "/sandbox", runtime: fake.runtime });

    await expect(
      store.commit({ schemaVersion: 1, hostProofRuns: 5, lastResult: "failed" }),
    ).rejects.toThrow("move failed");
    expect(fake.files.get(currentPath)).toBe(previous);
    await expect(store.load()).resolves.toEqual({ schemaVersion: 1, hostProofRuns: 4 });
  });

  test("recovers the prior state after interruption between backup and activation", async () => {
    const currentPath = "/sandbox/mobile-state.json";
    const previousPath = `${currentPath}.previous`;
    const temporaryPath = `${currentPath}.tmp`;
    const previous = JSON.stringify({ schemaVersion: 1, hostProofRuns: 7 });
    const staged = JSON.stringify({ schemaVersion: 1, hostProofRuns: 8 });
    const fake = fakeRuntime({ [previousPath]: previous, [temporaryPath]: staged });
    const store = createBunStateStore({ root: "/sandbox", runtime: fake.runtime });

    await expect(store.load()).resolves.toEqual({ schemaVersion: 1, hostProofRuns: 7 });
    expect(fake.files.get(currentPath)).toBe(previous);
    expect(fake.files.has(previousPath)).toBe(false);
    expect(fake.files.has(temporaryPath)).toBe(false);
  });

  test("recovers a staged first write when no prior state exists", async () => {
    const currentPath = "/sandbox/mobile-state.json";
    const temporaryPath = `${currentPath}.tmp`;
    const staged = JSON.stringify({ schemaVersion: 1, hostProofRuns: 1 });
    const fake = fakeRuntime({ [temporaryPath]: staged });
    const store = createBunStateStore({ root: "/sandbox", runtime: fake.runtime });

    await expect(store.load()).resolves.toEqual({ schemaVersion: 1, hostProofRuns: 1 });
    expect(fake.files.get(currentPath)).toBe(staged);
    expect(fake.files.has(temporaryPath)).toBe(false);
  });
});
