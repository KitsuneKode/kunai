import { describe, expect, test } from "bun:test";

import { runMobileApplication } from "../../../../src/application/run-mobile-application";
import type { AShellJsc } from "../../../../src/runtime/ashell/ashell-globals";
import { createAShellStateStore } from "../../../../src/runtime/ashell/ashell-state-store";
import { FakeMobileEnvironment } from "../../../support/fake-mobile-environment";

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
    delete(path) {
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
  test("application failure recording cannot destroy state after native activation exceptions", async () => {
    const committed = JSON.stringify({ schemaVersion: 1, hostProofRuns: 8 });
    const fixture = stateFixture({ [CURRENT]: committed });
    const move = fixture.jsc.move;
    fixture.jsc.move = (from, to) => {
      if (from === TEMPORARY) throw new Error("native failure");
      return move(from, to);
    };
    const fake = new FakeMobileEnvironment();
    fake.choices.push({ kind: "selected", value: "continue" });
    const result = await runMobileApplication({
      argv: [
        "--host-proof",
        "--probe-url",
        "https://probe.example/status",
        "--media-url",
        "https://media.example/video",
      ],
      environment: { ...fake.environment, state: createAShellStateStore(fixture.jsc) },
      version: "test",
    });
    expect(result.code).toBe(1);
    expect(fake.playerRequests).toEqual([]);
    expect(fixture.files.get(CURRENT) ?? fixture.files.get(PREVIOUS)).toBe(committed);
  });
  test("preserves committed state through thrown activation and failure-recording retries", async () => {
    const committed = JSON.stringify({ schemaVersion: 1, hostProofRuns: 8 });
    const fixture = stateFixture({ [CURRENT]: committed });
    const move = fixture.jsc.move;
    fixture.jsc.move = (from, to) => {
      if (from === TEMPORARY) throw new Error("native failure");
      return move(from, to);
    };
    const store = createAShellStateStore(fixture.jsc);
    for (const lastResult of ["http-ok", "failed"] as const) {
      await expect(
        store.commit({ schemaVersion: 1, hostProofRuns: 9, lastResult }),
      ).rejects.toThrow();
      expect(fixture.files.get(CURRENT) ?? fixture.files.get(PREVIOUS)).toBe(committed);
    }
  });

  test("retains the backup when both activation and restoration throw", async () => {
    const committed = JSON.stringify({ schemaVersion: 1, hostProofRuns: 8 });
    const fixture = stateFixture({ [CURRENT]: committed });
    const move = fixture.jsc.move;
    fixture.jsc.move = (from, to) => {
      if (from === TEMPORARY || from === PREVIOUS) throw new Error("native failure");
      return move(from, to);
    };
    const store = createAShellStateStore(fixture.jsc);
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(store.commit({ schemaVersion: 1, hostProofRuns: 9 })).rejects.toThrow();
      expect(fixture.files.get(PREVIOUS)).toBe(committed);
    }
  });
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

  test("recovers the prior state after interruption between backup and activation", async () => {
    const previous = JSON.stringify({ schemaVersion: 1, hostProofRuns: 7 });
    const staged = JSON.stringify({ schemaVersion: 1, hostProofRuns: 8 });
    const fixture = stateFixture({ [PREVIOUS]: previous, [TEMPORARY]: staged });
    const store = createAShellStateStore(fixture.jsc);

    await expect(store.load()).resolves.toEqual({ schemaVersion: 1, hostProofRuns: 7 });
    expect(fixture.files.get(CURRENT)).toBe(previous);
    expect(fixture.files.has(PREVIOUS)).toBe(false);
    expect(fixture.files.has(TEMPORARY)).toBe(false);
  });

  test("recovers a staged first write when no prior state exists", async () => {
    const staged = JSON.stringify({ schemaVersion: 1, hostProofRuns: 1 });
    const fixture = stateFixture({ [TEMPORARY]: staged });
    const store = createAShellStateStore(fixture.jsc);

    await expect(store.load()).resolves.toEqual({ schemaVersion: 1, hostProofRuns: 1 });
    expect(fixture.files.get(CURRENT)).toBe(staged);
    expect(fixture.files.has(TEMPORARY)).toBe(false);
  });
});
