import { describe, expect, test } from "bun:test";

import type { DetachedPlayerTarget } from "@/domain/playback/player-choice";
import {
  launchAndroidIntent,
  defaultAndroidIntentRuntime,
  resolveAndroidIntentCommand,
  type AndroidIntentRuntime,
} from "@/infra/player/android-intent-launcher";

const URL = "https://media.example/episode.m3u8?token=secret&title=one%20two";

function output(text: string): ReadableStream<Uint8Array> {
  // SAFETY: Bun's Response.body is a ReadableStream<Uint8Array>; the cast only
  // names the element type lib.dom leaves unparameterized.
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
  test("the native runtime kills an aborted launcher process", async () => {
    const controller = new AbortController();
    const process = defaultAndroidIntentRuntime.spawn(
      [globalThis.process.execPath, "-e", 'console.log("ready"); setInterval(() => {}, 1000000)'],
      { signal: controller.signal },
    );
    const reader = process.stdout?.getReader();
    try {
      expect(new TextDecoder().decode((await reader?.read())?.value)).toContain("ready");
      controller.abort();
      expect(await process.exited).not.toBe(0);
    } finally {
      controller.abort();
      await reader?.cancel();
      reader?.releaseLock();
      await process.exited;
    }
  });

  test("an already cancelled request never spawns", async () => {
    let spawned = false;
    await expect(
      launchAndroidIntent({
        target: "vlc",
        url: URL,
        signal: AbortSignal.abort(),
        runtime: runtime({
          commands: { am: "/system/bin/am" },
          onSpawn: () => {
            spawned = true;
          },
        }),
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(spawned).toBe(false);
  });

  test("cancellation during spawn cannot report an accepted handoff", async () => {
    const controller = new AbortController();
    await expect(
      launchAndroidIntent({
        target: "vlc",
        url: URL,
        signal: controller.signal,
        runtime: runtime({
          commands: { am: "/system/bin/am" },
          onSpawn: () => controller.abort(),
        }),
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  test("a launcher deadline bounds both process exit and open output pipes", async () => {
    let deadline: (() => void) | undefined;
    let cleared = false;
    let cancelled = false;
    let pipe: ReadableStreamDefaultController<Uint8Array> | undefined;
    const exit = Promise.withResolvers<number>();
    const attempt = launchAndroidIntent({
      target: "vlc",
      url: URL,
      timers: {
        setTimeout(callback, delayMs) {
          expect(delayMs).toBe(10_000);
          deadline = callback;
          return 1;
        },
        clearTimeout: () => {
          cleared = true;
        },
      },
      runtime: {
        which: () => "/system/bin/am",
        spawn: () => ({
          exited: exit.promise,
          stdout: new ReadableStream<Uint8Array>({
            start: (controller) => {
              pipe = controller;
            },
            cancel: () => {
              cancelled = true;
            },
          }),
        }),
      },
    });
    // Drive the deadline directly: no sleeps and no reliance on a test timeout.
    deadline?.();
    exit.resolve(0);
    if (!deadline) pipe?.close();
    expect(await attempt).toMatchObject({
      ok: false,
      reason: "launch-rejected",
      detail: "Android player launch timed out",
    });
    expect(cleared).toBe(true);
    expect(cancelled).toBe(true);
  });

  test("excessive launcher output is refused even when the child exits zero", async () => {
    expect(
      await launchAndroidIntent({
        target: "vlc",
        url: URL,
        runtime: runtime({ commands: { am: "/system/bin/am" }, stdout: "x".repeat(65_537) }),
      }),
    ).toMatchObject({
      ok: false,
      reason: "launch-rejected",
      detail: "Android launcher output exceeded 64 KiB",
    });
  });

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

  test("subtitle extras land per player: --esa subs for mpv, --es subtitles_location for vlc", () => {
    const rt = {
      which: (c: string) => (c === "termux-am" ? "/usr/bin/termux-am" : null),
      spawn: () => ({ exited: Promise.resolve(0) }),
    };
    const mpv = resolveAndroidIntentCommand({
      target: "mpv",
      url: "http://127.0.0.1:1/g/t/media",
      subtitles: ["http://127.0.0.1:1/g/t/sub/0", "http://127.0.0.1:1/g/t/sub/1"],
      runtime: rt,
    });
    expect(mpv.ok).toBe(true);
    if (mpv.ok) {
      const i = mpv.argv.indexOf("--esa");
      expect(mpv.argv[i + 1]).toBe("subs");
      expect(mpv.argv[i + 2]).toBe("http://127.0.0.1:1/g/t/sub/0,http://127.0.0.1:1/g/t/sub/1");
    }
    const vlc = resolveAndroidIntentCommand({
      target: "vlc",
      url: "http://127.0.0.1:1/g/t/media",
      subtitles: ["http://127.0.0.1:1/g/t/sub/0"],
      runtime: rt,
    });
    if (vlc.ok) {
      const i = vlc.argv.indexOf("--es");
      expect(vlc.argv[i + 1]).toBe("subtitles_location");
      expect(vlc.argv[i + 2]).toBe("http://127.0.0.1:1/g/t/sub/0");
    }
    // Chooser cannot target a package, so it carries no extras.
    const chooser = resolveAndroidIntentCommand({
      target: "chooser",
      url: "http://127.0.0.1:1/g/t/media",
      subtitles: ["http://127.0.0.1:1/g/t/sub/0"],
      runtime: rt,
    });
    if (chooser.ok) expect(chooser.argv.join(" ")).not.toContain("subs");
  });
});
