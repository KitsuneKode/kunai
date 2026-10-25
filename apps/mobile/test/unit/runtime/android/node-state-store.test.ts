import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runMobileApplication } from "../../../../src/application/run-mobile-application";
import {
  createNodeStateStore,
  type AndroidStateRuntime,
} from "../../../../src/runtime/android/node-state-store";
import { FakeMobileEnvironment } from "../../../support/fake-mobile-environment";

type FakeNodeStateRuntime = {
  readonly files: Map<string, string>;
  readonly moves: [string, string][];
  failMoveFrom?: string;
  readonly runtime: AndroidStateRuntime;
};

function fakeRuntime(initial: Readonly<Record<string, string>> = {}): FakeNodeStateRuntime {
  const files = new Map(Object.entries(initial));
  const moves: [string, string][] = [];
  const result: FakeNodeStateRuntime = {
    files,
    moves,
    runtime: {
      ensureDirectory: async () => {},
      readText: async (path) => files.get(path),
      writeText: async (path, value) => {
        files.set(path, value);
      },
      remove: async (path) => {
        files.delete(path);
      },
      move: async (from, to) => {
        moves.push([from, to]);
        if (from === result.failMoveFrom) throw new Error("move failed");
        const value = files.get(from);
        if (value === undefined) throw new Error("source missing");
        files.delete(from);
        files.set(to, value);
      },
    },
  };
  return result;
}

describe("Node Android state store", () => {
  test("preserves committed state when application failure recording retries failed activation and restoration", async () => {
    const currentPath = join("/sandbox", "mobile-state.json");
    const previousPath = `${currentPath}.previous`;
    const temporaryPath = `${currentPath}.tmp`;
    const previous = JSON.stringify({ schemaVersion: 1, hostProofRuns: 4 });
    const fake = fakeRuntime({ [currentPath]: previous });
    let movesFail = true;
    const store = createNodeStateStore({
      root: "/sandbox",
      runtime: {
        ...fake.runtime,
        async move(from, to) {
          if (movesFail && (from === temporaryPath || from === previousPath)) {
            throw new Error("move failed");
          }
          await fake.runtime.move(from, to);
        },
      },
    });
    const environment = new FakeMobileEnvironment();
    environment.choices.push({ kind: "selected", value: "continue" });
    const result = await runMobileApplication({
      version: "test",
      argv: [
        "--host-proof",
        "--probe-url",
        "https://probe.example/status",
        "--media-url",
        "https://media.example/video.mp4",
      ],
      environment: { ...environment.environment, state: store },
    });

    expect(result).toEqual({ code: 1, reason: "failed" });
    expect(fake.files.get(previousPath)).toBe(previous);
    expect(environment.playerRequests).toEqual([]);
    movesFail = false;
    await expect(store.load()).resolves.toEqual({ schemaVersion: 1, hostProofRuns: 4 });
    expect(fake.files.has(temporaryPath)).toBe(false);
  });

  test("restores committed state before failed temporary cleanup can strand the backup", async () => {
    const currentPath = join("/sandbox", "mobile-state.json");
    const previousPath = `${currentPath}.previous`;
    const temporaryPath = `${currentPath}.tmp`;
    const previous = JSON.stringify({ schemaVersion: 1, hostProofRuns: 4 });
    const fake = fakeRuntime({ [currentPath]: previous });
    let activationFailed = false;
    const store = createNodeStateStore({
      root: "/sandbox",
      runtime: {
        ...fake.runtime,
        async move(from, to) {
          if (from === temporaryPath) {
            activationFailed = true;
            throw new Error("activation failed");
          }
          await fake.runtime.move(from, to);
        },
        async remove(path) {
          if (activationFailed && path === temporaryPath) throw new Error("cleanup failed");
          await fake.runtime.remove(path);
        },
      },
    });

    await expect(store.commit({ schemaVersion: 1, hostProofRuns: 5 })).rejects.toThrow();
    expect(fake.files.get(currentPath)).toBe(previous);
    expect(fake.files.has(previousPath)).toBe(false);
  });

  test("rejects a corrupt sole backup before a retry can discard it", async () => {
    const currentPath = join("/sandbox", "mobile-state.json");
    const previousPath = `${currentPath}.previous`;
    const fake = fakeRuntime({ [previousPath]: "not json" });
    const store = createNodeStateStore({ root: "/sandbox", runtime: fake.runtime });

    await expect(store.commit({ schemaVersion: 1, hostProofRuns: 5 })).rejects.toThrow(
      "Invalid mobile state",
    );
    expect(fake.files.get(previousPath)).toBe("not json");
    expect(fake.files.has(currentPath)).toBe(false);
  });

  test("creates private state directories and files with the concrete Node runtime", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "kunai-mobile-node-state-"));
    const root = join(sandbox, "state");
    try {
      const store = createNodeStateStore({ root });
      await store.commit({ schemaVersion: 1, hostProofRuns: 1, lastResult: "cancelled" });

      await expect(store.load()).resolves.toEqual({
        schemaVersion: 1,
        hostProofRuns: 1,
        lastResult: "cancelled",
      });
      // Windows does not implement POSIX permission bits.
      if (process.platform !== "win32") {
        expect((await stat(root)).mode & 0o777).toBe(0o700);
        expect((await stat(join(root, "mobile-state.json"))).mode & 0o777).toBe(0o600);
      }
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  test("loads a default only when the state file is missing", async () => {
    const fake = fakeRuntime();
    const store = createNodeStateStore({ root: "/sandbox", runtime: fake.runtime });

    await expect(store.load()).resolves.toEqual({ schemaVersion: 1, hostProofRuns: 0 });
    fake.files.set(join("/sandbox", "mobile-state.json"), "not json");
    await expect(store.load()).rejects.toThrow("Invalid mobile state");
  });

  test("writes and validates a temporary file before atomic activation", async () => {
    const fake = fakeRuntime();
    const store = createNodeStateStore({ root: "/sandbox", runtime: fake.runtime });

    await store.commit({ schemaVersion: 1, hostProofRuns: 1, lastResult: "http-ok" });

    expect(fake.moves).toContainEqual([
      join("/sandbox", "mobile-state.json.tmp"),
      join("/sandbox", "mobile-state.json"),
    ]);
    await expect(store.load()).resolves.toEqual({
      schemaVersion: 1,
      hostProofRuns: 1,
      lastResult: "http-ok",
    });
  });

  test("restores the prior valid state when final activation fails", async () => {
    const currentPath = join("/sandbox", "mobile-state.json");
    const temporaryPath = `${currentPath}.tmp`;
    const previous = JSON.stringify({ schemaVersion: 1, hostProofRuns: 4 });
    const fake = fakeRuntime({ [currentPath]: previous });
    fake.failMoveFrom = temporaryPath;
    const store = createNodeStateStore({ root: "/sandbox", runtime: fake.runtime });

    await expect(
      store.commit({ schemaVersion: 1, hostProofRuns: 5, lastResult: "failed" }),
    ).rejects.toThrow("move failed");
    expect(fake.files.get(currentPath)).toBe(previous);
    await expect(store.load()).resolves.toEqual({ schemaVersion: 1, hostProofRuns: 4 });
  });

  test("recovers the prior state after interruption between backup and activation", async () => {
    const currentPath = join("/sandbox", "mobile-state.json");
    const previousPath = `${currentPath}.previous`;
    const temporaryPath = `${currentPath}.tmp`;
    const previous = JSON.stringify({ schemaVersion: 1, hostProofRuns: 7 });
    const staged = JSON.stringify({ schemaVersion: 1, hostProofRuns: 8 });
    const fake = fakeRuntime({ [previousPath]: previous, [temporaryPath]: staged });
    const store = createNodeStateStore({ root: "/sandbox", runtime: fake.runtime });

    await expect(store.load()).resolves.toEqual({ schemaVersion: 1, hostProofRuns: 7 });
    expect(fake.files.get(currentPath)).toBe(previous);
    expect(fake.files.has(previousPath)).toBe(false);
    expect(fake.files.has(temporaryPath)).toBe(false);
  });

  test("recovers a staged first write when no prior state exists", async () => {
    const currentPath = join("/sandbox", "mobile-state.json");
    const temporaryPath = `${currentPath}.tmp`;
    const staged = JSON.stringify({ schemaVersion: 1, hostProofRuns: 1 });
    const fake = fakeRuntime({ [temporaryPath]: staged });
    const store = createNodeStateStore({ root: "/sandbox", runtime: fake.runtime });

    await expect(store.load()).resolves.toEqual({ schemaVersion: 1, hostProofRuns: 1 });
    expect(fake.files.get(currentPath)).toBe(staged);
    expect(fake.files.has(temporaryPath)).toBe(false);
  });
});
