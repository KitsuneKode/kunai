import { describe, expect, test } from "bun:test";

import type { MpvIpcCommandResult, MpvIpcSession } from "@/infra/player/mpv-ipc";
import { PersistentSubtitleManager } from "@/infra/player/persistent-subtitle-manager";

function createFakeIpc(failCommand?: string): {
  ipc: MpvIpcSession;
  commands: readonly unknown[][];
} {
  const commands: unknown[][] = [];
  const ipc: MpvIpcSession = {
    async send(command) {
      commands.push([...command]);
      const ok = command[0] !== failCommand;
      return ok
        ? ({
            ok: true,
            command,
            requestId: commands.length,
            response: {},
          } satisfies MpvIpcCommandResult)
        : ({
            ok: false,
            command,
            requestId: commands.length,
            error: "failed",
          } satisfies MpvIpcCommandResult);
    },
    sendUnchecked(command) {
      commands.push([...command]);
    },
    async close() {},
  };
  return { ipc, commands };
}

describe("PersistentSubtitleManager", () => {
  test("removes only cached external subtitle ids", async () => {
    const { ipc, commands } = createFakeIpc();
    const manager = new PersistentSubtitleManager();

    manager.updateTrackList([
      { id: 1, type: "sub", external: false },
      { id: 2, type: "sub", external: true },
      { id: 3, type: "audio", external: true },
      { id: 4, type: "sub", external: true },
    ]);

    await manager.removeExternalSubtitles(ipc);

    expect(commands).toEqual([
      ["sub-remove", 2],
      ["sub-remove", 4],
    ]);
  });

  test("replaces subtitle inventory and reports attached count", async () => {
    const { ipc, commands } = createFakeIpc();
    const manager = new PersistentSubtitleManager();
    manager.updateTrackList([{ id: 7, type: "sub", external: true }]);
    const attachedCounts: number[] = [];

    await manager.replaceSubtitleInventory(
      ipc,
      "https://subs.example/main.vtt",
      [
        {
          url: "https://subs.example/main.vtt",
          display: "English",
          language: "en",
          sourceKind: "external",
          sourceName: "provider",
        },
        {
          url: "https://subs.example/alt.vtt",
          display: "Spanish",
          language: "es",
          sourceKind: "external",
          sourceName: "provider",
        },
      ],
      (count) => attachedCounts.push(count),
    );

    expect(commands).toEqual([
      ["sub-remove", 7],
      ["sub-add", "https://subs.example/main.vtt", "select", "English", "en"],
      ["sub-add", "https://subs.example/alt.vtt", "auto", "Spanish", "es"],
    ]);
    expect(attachedCounts).toEqual([2]);
  });

  test("late subtitle attachment classifies missing ipc", async () => {
    const manager = new PersistentSubtitleManager();

    await expect(
      manager.attachSubtitles(null, { primarySubtitle: "https://subs.example/main.vtt" }),
    ).resolves.toEqual({
      status: "no-ipc",
      attachedCount: 0,
    });
  });

  test("late subtitle attachment classifies failed sub-add commands", async () => {
    const { ipc } = createFakeIpc("sub-add");
    const manager = new PersistentSubtitleManager();

    const result = await manager.attachSubtitles(ipc, {
      primarySubtitle: "https://subs.example/main.vtt",
      subtitleTracks: [
        {
          url: "https://subs.example/main.vtt",
          display: "English",
          language: "en",
          sourceKind: "external",
          sourceName: "provider",
        },
      ],
    });

    expect(result).toEqual({
      status: "sub-add-failed",
      attachedCount: 0,
      failedTrack: "primary",
    });
  });
});
