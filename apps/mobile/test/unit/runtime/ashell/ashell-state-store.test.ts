import { describe, expect, test } from "bun:test";

import type { AShellJsc } from "../../../../src/runtime/ashell/ashell-globals";
import { createAShellStateStore } from "../../../../src/runtime/ashell/ashell-state-store";

const CURRENT = ".runtime/mobile-state.json";
const TEMPORARY = `${CURRENT}.tmp`;
const PREVIOUS = ".runtime/mobile-state.previous";

function stateFixture(initial: Readonly<Record<string, string>> = {}) {
  const files = new Map(Object.entries(initial));
  const writes: [string, string][] = [];
  const moves: [string, string][] = [];
  let failWrite = false;
  let failMoveFrom: string | undefined;
  const jsc: AShellJsc = {
    readFile(path) {
      const value = files.get(path);
      if (value === undefined) throw new Error("missing file");
      return value;
    },
    writeFile(path, value) {
      writes.push([path, value]);
      if (failWrite) return 1;
      files.set(path, value);
      return 0;
    },
    isFile: (path) => files.has(path),
    makeFolder: () => 0,
    deleteFile(path) {
      files.delete(path);
      return 0;
    },
    move(from, to) {
      moves.push([from, to]);
      if (from === failMoveFrom) return 1;
      const value = files.get(from);
      if (value === undefined) return 1;
      files.delete(from);
      files.set(to, value);
      return 0;
    },
    system: () => 0,
  };
  return {
    files,
    writes,
    moves,
    jsc,
    setFailWrite(value: boolean) {
      failWrite = value;
    },
    setFailMoveFrom(value: string | undefined) {
      failMoveFrom = value;
    },
  };
}

describe("a-Shell state store", () => {
  test("loads a default only for a missing state file", async () => {
    const fixture = stateFixture();
    const store = createAShellStateStore(fixture.jsc);
    await expect(store.load()).resolves.toEqual({ schemaVersion: 1, hostProofRuns: 0 });

    fixture.files.set(CURRENT, JSON.stringify({ schemaVersion: 1, hostProofRuns: 4 }));
    await expect(store.load()).resolves.toEqual({ schemaVersion: 1, hostProofRuns: 4 });

    fixture.files.set(CURRENT, "not-json");
    await expect(store.load()).rejects.toThrow("Invalid mobile state");
    fixture.files.set(CURRENT, JSON.stringify({ schemaVersion: 2, hostProofRuns: 4 }));
    await expect(store.load()).rejects.toThrow("Invalid mobile state");
  });

  test("writes and validates only the temporary file before activation", async () => {
    const fixture = stateFixture();
    const store = createAShellStateStore(fixture.jsc);
    await store.commit({ schemaVersion: 1, hostProofRuns: 1, lastResult: "http-ok" });

    expect(fixture.writes.map(([path]) => path)).toEqual([TEMPORARY]);
    expect(fixture.moves).toContainEqual([TEMPORARY, CURRENT]);
    await expect(store.load()).resolves.toEqual({
      schemaVersion: 1,
      hostProofRuns: 1,
      lastResult: "http-ok",
    });
  });

  test("surfaces temporary write failure without replacing current state", async () => {
    const previous = JSON.stringify({ schemaVersion: 1, hostProofRuns: 3 });
    const fixture = stateFixture({ [CURRENT]: previous });
    fixture.setFailWrite(true);
    const store = createAShellStateStore(fixture.jsc);

    await expect(store.commit({ schemaVersion: 1, hostProofRuns: 4 })).rejects.toThrow(
      "state write failed",
    );
    expect(fixture.files.get(CURRENT)).toBe(previous);
  });

  test("restores the prior valid state when final activation fails", async () => {
    const previous = JSON.stringify({ schemaVersion: 1, hostProofRuns: 8 });
    const fixture = stateFixture({ [CURRENT]: previous });
    fixture.setFailMoveFrom(TEMPORARY);
    const store = createAShellStateStore(fixture.jsc);

    await expect(store.commit({ schemaVersion: 1, hostProofRuns: 9 })).rejects.toThrow(
      "state activation failed",
    );
    expect(fixture.moves).toContainEqual([CURRENT, PREVIOUS]);
    expect(fixture.moves).toContainEqual([PREVIOUS, CURRENT]);
    expect(fixture.files.get(CURRENT)).toBe(previous);
    await expect(store.load()).resolves.toEqual({ schemaVersion: 1, hostProofRuns: 8 });
  });
});
