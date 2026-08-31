import { describe, expect, test } from "bun:test";

import type { DetachedPlayerTarget } from "@/domain/playback/player-choice";
import {
  launchAndroidIntent,
  resolveAndroidIntentCommand,
  type AndroidIntentRuntime,
} from "@/infra/player/android-intent-launcher";

const URL = "https://media.example/episode.m3u8?token=secret&title=one%20two";

function output(text: string): ReadableStream<Uint8Array> {
  return new Response(text).body as ReadableStream<Uint8Array>;
}

function runtime(input: {
  readonly commands?: Readonly<Record<string, string>>;
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly onSpawn?: (argv: readonly string[]) => void;
}): AndroidIntentRuntime {
  return {
    which: (command) => input.commands?.[command] ?? null,
    spawn: (argv) => {
      input.onSpawn?.(argv);
      return {
        exited: Promise.resolve(input.exitCode ?? 0),
        stdout: output(input.stdout ?? ""),
        stderr: output(input.stderr ?? ""),
      };
    },
  };
}

describe("Android intent command resolution", () => {
  test("prefers termux-am and builds an ACTION_VIEW chooser command", () => {
    const resolved = resolveAndroidIntentCommand({
      target: "chooser",
      url: URL,
      runtime: runtime({
        commands: {
          "termux-am": "/data/data/com.termux/files/usr/bin/termux-am",
          am: "/system/bin/am",
        },
      }),
    });

    expect(resolved).toEqual({
      ok: true,
      launcher: "termux-am",
      argv: [
        "/data/data/com.termux/files/usr/bin/termux-am",
        "start",
        "-a",
        "android.intent.action.VIEW",
        "-d",
        URL,
        "-t",
        "video/*",
      ],
    });
  });

  test("falls back to am and pins the requested player package", () => {
    for (const [target, playerPackage] of [
      ["vlc", "org.videolan.vlc"],
      ["mpv", "is.xyz.mpv"],
    ] as const satisfies readonly (readonly [DetachedPlayerTarget, string])[]) {
      expect(
        resolveAndroidIntentCommand({
          target,
          url: URL,
          runtime: runtime({ commands: { am: "/system/bin/am" } }),
        }),
      ).toEqual({
        ok: true,
        launcher: "am",
        argv: [
          "/system/bin/am",
          "start",
          "-a",
          "android.intent.action.VIEW",
          "-d",
          URL,
          "-t",
          "video/*",
          "-p",
          playerPackage,
        ],
      });
    }
  });

  test("uses termux-open-url only for the chooser", () => {
    const chooser = resolveAndroidIntentCommand({
      target: "chooser",
      url: URL,
      runtime: runtime({ commands: { "termux-open-url": "/usr/bin/termux-open-url" } }),
    });
    expect(chooser).toEqual({
      ok: true,
      launcher: "termux-open-url",
      argv: ["/usr/bin/termux-open-url", URL],
    });

    const explicit = resolveAndroidIntentCommand({
      target: "vlc",
      url: URL,
      runtime: runtime({ commands: { "termux-open-url": "/usr/bin/termux-open-url" } }),
    });
    expect(explicit).toEqual({ ok: false, reason: "intent-launcher-missing" });
  });

  test("uses modern termux-open chooser and MIME flags before the legacy URL helper", () => {
    expect(
      resolveAndroidIntentCommand({
        target: "chooser",
        url: URL,
        runtime: runtime({
          commands: {
            "termux-open": "/usr/bin/termux-open",
            "termux-open-url": "/usr/bin/termux-open-url",
          },
        }),
      }),
    ).toEqual({
      ok: true,
      launcher: "termux-open",
      argv: ["/usr/bin/termux-open", "--view", "--chooser", "--content-type", "video/*", URL],
    });
  });

  test("returns a typed failure when no supported launcher exists", () => {
    expect(
      resolveAndroidIntentCommand({ target: "chooser", url: URL, runtime: runtime({}) }),
    ).toEqual({ ok: false, reason: "intent-launcher-missing" });
  });
});

describe("Android intent launch", () => {
  test("passes a metacharacter-rich URL as one opaque argv value", async () => {
    const commands: string[][] = [];
    const result = await launchAndroidIntent({
      target: "vlc",
      url: URL,
      runtime: runtime({
        commands: { "termux-am": "/usr/bin/termux-am" },
        onSpawn: (argv) => commands.push([...argv]),
      }),
    });

    expect(result).toEqual({ ok: true, launcher: "termux-am" });
    expect(commands).toHaveLength(1);
    expect(commands[0]?.filter((argument) => argument === URL)).toHaveLength(1);
  });

  test("classifies a missing explicit player package", async () => {
    const result = await launchAndroidIntent({
      target: "vlc",
      url: URL,
      runtime: runtime({
        commands: { am: "/system/bin/am" },
        exitCode: 1,
        stderr: "Error type 3: Activity class does not exist",
      }),
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "player-not-installed",
      launcher: "am",
    });
  });

  test("redacts URL query values and bounds rejected launch diagnostics", async () => {
    const result = await launchAndroidIntent({
      target: "chooser",
      url: URL,
      runtime: runtime({
        commands: { am: "/system/bin/am" },
        exitCode: 2,
        stderr: `Rejected ${URL} ${"x".repeat(4_000)}`,
      }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected launch failure");
    expect(result.reason).toBe("launch-rejected");
    expect(result.detail).toContain("token=REDACTED");
    expect(result.detail).not.toContain("secret");
    expect(result.detail?.length).toBeLessThanOrEqual(2_048);
  });

  test("maps a synchronous spawn exception to launch-rejected", async () => {
    const failingRuntime: AndroidIntentRuntime = {
      which: () => "/usr/bin/termux-am",
      spawn: () => {
        throw new Error("spawn failed");
      },
    };

    expect(
      await launchAndroidIntent({ target: "chooser", url: URL, runtime: failingRuntime }),
    ).toEqual({
      ok: false,
      reason: "launch-rejected",
      launcher: "termux-am",
      detail: "spawn failed",
    });
  });
});
