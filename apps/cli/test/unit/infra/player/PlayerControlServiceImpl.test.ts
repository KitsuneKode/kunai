import { expect, test } from "bun:test";

import { PlayerControlServiceImpl } from "@/infra/player/PlayerControlServiceImpl";

function makeService() {
  return new PlayerControlServiceImpl({
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
      fatal() {},
      child() {
        return this;
      },
    },
    diagnosticsStore: {
      record() {},
      getRecent() {
        return [];
      },
      getSnapshot() {
        return [];
      },
      clear() {},
    },
  });
}

test("PlayerControlServiceImpl stops the active player and clears no state implicitly", async () => {
  let stoppedReason = "";
  const service = makeService();

  service.setActive({
    id: "player-1",
    async stop(reason) {
      stoppedReason = reason ?? "";
    },
  });

  expect(await service.stopCurrentPlayback("test-stop")).toBe(true);
  expect(stoppedReason).toBe("test-stop");
  expect(service.getActive()?.id).toBe("player-1");
  expect(service.consumeLastAction()).toBe("stop");
  expect(service.consumeLastAction()).toBeNull();
});

test("PlayerControlServiceImpl reports false when no player is active", async () => {
  const service = makeService();

  expect(await service.stopCurrentPlayback("nothing-active")).toBe(false);
});

test("PlayerControlServiceImpl records refresh and fallback as stop-backed intents", async () => {
  const stoppedReasons: string[] = [];
  const stoppedCurrentReasons: string[] = [];
  const service = makeService();

  service.setActive({
    id: "player-1",
    async stop(reason) {
      stoppedReasons.push(reason ?? "");
    },
    async stopCurrentFile(reason) {
      stoppedCurrentReasons.push(reason ?? "");
    },
  });

  expect(await service.refreshCurrentPlayback("refresh-key")).toBe(true);
  expect(service.consumeLastAction()).toBe("refresh");
  expect(await service.fallbackCurrentPlayback("fallback-key")).toBe(true);
  expect(service.consumeLastAction()).toBe("fallback");
  expect(stoppedReasons).toEqual([]);
  expect(stoppedCurrentReasons).toEqual(["refresh-key", "fallback-key"]);
});

test("PlayerControlServiceImpl reloads subtitles without stopping playback", async () => {
  let reloaded = 0;
  const service = makeService();

  service.setActive({
    id: "player-1",
    async stop() {
      throw new Error("stop should not be called");
    },
    async reloadSubtitles() {
      reloaded += 1;
    },
  });

  expect(await service.reloadCurrentSubtitles("subtitle-key")).toBe(true);
  expect(service.consumeLastAction()).toBe("reload-subtitles");
  expect(reloaded).toBe(1);
});

test("PlayerControlServiceImpl skips the active timing segment without stopping playback", async () => {
  let skipped = 0;
  const service = makeService();

  service.setActive({
    id: "player-1",
    async stop() {
      throw new Error("stop should not be called");
    },
    async skipCurrentSegment() {
      skipped += 1;
      return true;
    },
  });

  expect(await service.skipCurrentSegment("skip-key")).toBe(true);
  expect(skipped).toBe(1);
});

test("PlayerControlServiceImpl records next and previous episode intents as stop-backed actions", async () => {
  const stoppedCurrentReasons: string[] = [];
  const service = makeService();

  service.setActive({
    id: "player-1",
    async stop() {
      throw new Error("stop should not be called");
    },
    async stopCurrentFile(reason) {
      stoppedCurrentReasons.push(reason ?? "");
    },
  });

  expect(await service.nextCurrentPlayback("next-key")).toBe(true);
  expect(service.consumeLastAction()).toBe("next");
  expect(await service.previousCurrentPlayback("previous-key")).toBe(true);
  expect(service.consumeLastAction()).toBe("previous");
  expect(stoppedCurrentReasons).toEqual(["next-key", "previous-key"]);
});

test("PlayerControlServiceImpl falls back to full stop when file-stop control is unavailable", async () => {
  const stoppedReasons: string[] = [];
  const service = makeService();

  service.setActive({
    id: "player-1",
    async stop(reason) {
      stoppedReasons.push(reason ?? "");
    },
  });

  expect(await service.nextCurrentPlayback("next-key")).toBe(true);
  expect(service.consumeLastAction()).toBe("next");
  expect(await service.refreshCurrentPlayback("refresh-key")).toBe(true);
  expect(service.consumeLastAction()).toBe("refresh");
  expect(stoppedReasons).toEqual(["next-key", "refresh-key"]);
});

test("PlayerControlServiceImpl prioritizes stop controls over queued subtitle commands", async () => {
  let resolveAttach!: (value: number) => void;
  const attachStarted = Promise.withResolvers<void>();
  const attachRelease = new Promise<number>((resolve) => {
    resolveAttach = resolve;
  });
  const stoppedReasons: string[] = [];
  const service = makeService();

  service.setActive({
    id: "player-1",
    async stop(reason) {
      stoppedReasons.push(reason ?? "");
    },
    async attachSubtitles() {
      attachStarted.resolve();
      return await attachRelease;
    },
  });

  const attachPromise = service.attachLateSubtitles(
    { primarySubtitle: "https://example.test/sub.vtt", subtitleTracks: [] },
    "late-subtitle",
  );
  await attachStarted.promise;

  expect(await service.stopCurrentPlayback("escape")).toBe(true);
  expect(stoppedReasons).toEqual(["escape"]);

  resolveAttach(1);
  expect(await attachPromise).toBe(true);
});

test("PlayerControlServiceImpl waitForActivePlayer resolves immediately when active", async () => {
  const service = makeService();
  const ctrl = { id: "p", async stop() {} };
  service.setActive(ctrl);
  await expect(service.waitForActivePlayer({ timeoutMs: 1000 })).resolves.toBe(ctrl);
});

test("PlayerControlServiceImpl waitForActivePlayer resolves when control appears", async () => {
  const service = makeService();
  const ctrl = { id: "p", async stop() {} };
  const p = service.waitForActivePlayer({ timeoutMs: 2000 });
  queueMicrotask(() => service.setActive(ctrl));
  await expect(p).resolves.toBe(ctrl);
});

test("PlayerControlServiceImpl waitForActivePlayer times out with null", async () => {
  const service = makeService();
  await expect(service.waitForActivePlayer({ timeoutMs: 5 })).resolves.toBeNull();
});
