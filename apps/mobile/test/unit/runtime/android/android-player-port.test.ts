import { describe, expect, test } from "bun:test";

import {
  createAndroidPlayerPort,
  type AndroidPlayerRuntime,
} from "../../../../src/runtime/android/android-player-port";

const MEDIA_URL = "https://media.example/video.m3u8?token=a&title=$(touch%20nope)";

function runtime(input: {
  readonly commands?: Readonly<Record<string, string>>;
  readonly exitCode?: number;
  readonly onWhich?: (command: string) => void;
  readonly onSpawn?: (argv: readonly string[]) => void;
}): AndroidPlayerRuntime {
  return {
    which: (command) => {
      input.onWhich?.(command);
      return input.commands?.[command];
    },
    spawn: async (argv) => {
      input.onSpawn?.(argv);
      return { exitCode: input.exitCode ?? 0 };
    },
  };
}

describe("Android mobile player port", () => {
  test("hands VLC one opaque URL argument through the local intent plan", async () => {
    const spawned: string[][] = [];
    const player = createAndroidPlayerPort({
      runtime: runtime({
        commands: { "termux-am": "/usr/bin/termux-am" },
        onSpawn: (argv) => spawned.push([...argv]),
      }),
    });

    await expect(player.handoff({ player: "vlc", url: MEDIA_URL })).resolves.toEqual({
      kind: "accepted",
      launcher: "termux-am",
    });
    expect(spawned[0]?.filter((value) => value === MEDIA_URL)).toHaveLength(1);
    expect(spawned[0]).toContain("org.videolan.vlc");
  });

  test("returns fixed reasons for missing launchers and rejected commands", async () => {
    await expect(
      createAndroidPlayerPort({ runtime: runtime({}) }).handoff({
        player: "vlc",
        url: MEDIA_URL,
      }),
    ).resolves.toEqual({ kind: "rejected", reason: "intent-launcher-missing" });
    await expect(
      createAndroidPlayerPort({
        runtime: runtime({ commands: { am: "/system/bin/am" }, exitCode: 1 }),
      }).handoff({ player: "vlc", url: MEDIA_URL }),
    ).resolves.toEqual({ kind: "rejected", reason: "launch-rejected" });
  });

  test("probes only launchers that can produce an explicit VLC intent", async () => {
    const probes: string[] = [];

    await createAndroidPlayerPort({
      runtime: runtime({ onWhich: (command) => probes.push(command) }),
    }).handoff({ player: "vlc", url: MEDIA_URL });

    expect(probes).toEqual(["termux-am", "am"]);
  });
});
