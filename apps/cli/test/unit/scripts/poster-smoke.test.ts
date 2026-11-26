import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  hasPrintableGraphicsLeak,
  matchesPosterRedraw,
  posterProtocol,
} from "../../support/poster-smoke-evidence";
import {
  finishPosterSmoke,
  posterSmokeBunCommand,
  posterSmokeEnv,
  posterSmokeOption,
  posterSmokeWaylandEnv,
  runPosterSmokeTerminal,
  stopPosterSmokeTmux,
  withPosterSmokeSignals,
} from "../../support/poster-smoke-launcher";

describe("poster smoke evidence", () => {
  test("recognizes wrapped Kitty without mistaking a valid packet for raw text", () => {
    const transcript = "\x1bPtmux;\x1b\x1b_Ga=T,U=1,m=0;AAAA\x1b\x1b\\\x1b\\\u{10EEEE}";
    expect(posterProtocol(transcript)).toBe("kitty-tmux");
    expect(hasPrintableGraphicsLeak(transcript)).toBe(false);
  });

  test("requires actual placement and ignores the Kitty capability query", () => {
    const query = "\x1b_Gi=31,s=1,v=1,a=q;AAAA\x1b\\";
    expect(posterProtocol(query)).toBeNull();
    expect(posterProtocol(query + "\x1b[4;6H\x1b_Ga=p,i=8;\x1b\\")).toBe("kitty-direct");
  });

  test("flags printable escape fragments among otherwise valid ANSI", () => {
    expect(hasPrintableGraphicsLeak("\x1b[31m_Ga=T,U=1,m=0;AAAA\x1b[0m")).toBe(true);
    expect(hasPrintableGraphicsLeak("[0;1;0q\x221;1;16;16#1;2;0;0;0")).toBe(true);
    expect(hasPrintableGraphicsLeak("]1337;File=inline=1:AAAA")).toBe(true);
    expect(hasPrintableGraphicsLeak("Ptmux;")).toBe(true);
    expect(hasPrintableGraphicsLeak("Smoke Movie \x1b[38;2;1;2;3m▀\x1b[0m")).toBe(false);
  });

  test("flags truncated graphics packets even when the introducer is intact", () => {
    expect(hasPrintableGraphicsLeak("\x1b_Ga=T,U=1,m=0;AAAA")).toBe(true);
    expect(hasPrintableGraphicsLeak("\x1bPtmux;")).toBe(true);
    expect(hasPrintableGraphicsLeak("\x1bP0;1;0q\x221;1;16;16")).toBe(true);
    expect(hasPrintableGraphicsLeak("\x1b]1337;File=inline=1:AAAA")).toBe(true);
    expect(hasPrintableGraphicsLeak("\x1b]1337;File=inline=1:AAAA\x07")).toBe(false);
    expect(hasPrintableGraphicsLeak("\x1bP0;1;0q\x221;1;16;16\x1b\\")).toBe(false);
  });

  test("ignores ordinary text containing a q before a quote", () => {
    expect(hasPrintableGraphicsLeak('Search: "Iraq"')).toBe(false);
    expect(hasPrintableGraphicsLeak('0;1;0q"1;1;16;16')).toBe(true);
  });

  test("requires U=1 on the wrapped placement itself", () => {
    const wrap = (control: string) => `\x1bPtmux;\x1b\x1b_G${control};AAAA\x1b\x1b\\\x1b\\`;
    expect(posterProtocol(wrap("a=T,m=0") + wrap("a=q,U=1"))).toBeNull();
    expect(posterProtocol(wrap("a=T,U=10,m=0"))).toBeNull();
    expect(posterProtocol(wrap("U=1,a=T,m=0"))).toBe("kitty-tmux");
  });

  test.each([
    ["\x1bP0;1;0q#1~\x1b\\", "sixel"],
    ["\x1b_Ga=p,i=8;\x1b\\", "kitty-direct"],
    ["\x1b]1337;File=inline=1:AAAA\x07", "iterm-inline"],
  ])("waits for the complete %s packet", (packet, protocol) => {
    for (let offset = 1; offset < packet.length; offset++) {
      expect(posterProtocol(packet.slice(0, offset))).toBeNull();
    }
    expect(posterProtocol(packet)).toBe(protocol);
  });

  test("requires Sixel image data and visible half-blocks", () => {
    expect(posterProtocol("\x1bP0;1;0q\x1b\\")).toBeNull();
    expect(posterProtocol('\x1bP0;1;0q"1;1;16;16\x1b\\')).toBeNull();
    expect(hasPrintableGraphicsLeak("\x1bP0;1;0q")).toBe(true);
    expect(posterProtocol("\x1b]0;Title ▀\x07")).toBeNull();
    expect(posterProtocol("\x1b]0;Title\x07▀")).toBe("half-block");
  });

  test.each(["selection", "resize"])("requires the startup protocol after %s", (phase) => {
    const startup = posterProtocol("\x1bP0;1;0q#1~\x1b\\");
    expect(startup).toBe("sixel");
    if (startup === null) throw new Error("Sixel fixture was not detected");
    expect(matchesPosterRedraw(phase, startup, "\x1bP0;1;0q#1~")).toBe(false);
    expect(matchesPosterRedraw(phase, startup, "\x1bP0;1;0q#1~\x1b\\")).toBe(true);
    expect(() => matchesPosterRedraw(phase, startup, "▀")).toThrow(
      `${phase}: expected sixel, observed half-block`,
    );
  });
});

describe("poster smoke launcher", () => {
  test.each([
    ["SIGINT", 130],
    ["SIGTERM", 143],
    ["SIGHUP", 129],
  ])("cleans up the launched terminal on %s", async (signal, code) => {
    const signals = new EventEmitter();
    const exited = Promise.withResolvers<number>();
    const stopped: string[] = [];
    const result = runPosterSmokeTerminal(signals, {
      launch: () => ({
        exited: exited.promise,
        kill: () => {
          stopped.push("terminal");
          exited.resolve(1);
        },
      }),
      stopTmux: async () => {
        stopped.push("tmux");
        signals.emit("SIGINT");
      },
      removeHome: () => stopped.push("home"),
      readEvidence: async () => {
        throw new Error("interrupted smoke must not read evidence");
      },
    });

    signals.emit(signal);
    expect(await result).toBe(code);
    expect(stopped).toEqual(["terminal", "tmux", "home"]);
    expect(signals.eventNames()).toEqual([]);
  });

  test("preserves a complete Wayland pair and drops it when either value is missing", () => {
    const env = { WAYLAND_DISPLAY: "wayland-4", XDG_RUNTIME_DIR: "/run/user/1000" };
    expect(posterSmokeWaylandEnv(env)).toEqual(env);
    expect(posterSmokeWaylandEnv({ WAYLAND_DISPLAY: env.WAYLAND_DISPLAY })).toEqual({});
    expect(posterSmokeWaylandEnv({ XDG_RUNTIME_DIR: env.XDG_RUNTIME_DIR })).toEqual({});
  });

  test("child Bun ignores dotenv files in its working directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kunai-smoke-dotenv-"));
    try {
      writeFileSync(join(dir, ".env"), "POSTER_DOTENV_LEAK=unsafe\n");
      const script = join(dir, "print-env.ts");
      writeFileSync(
        script,
        "console.log(process.env.POSTER_DOTENV_LEAK ?? process.env.POSTER_EXPLICIT)",
      );
      const child = Bun.spawn(posterSmokeBunCommand(script), {
        cwd: dir,
        env: { ...posterSmokeEnv(dir, {}), POSTER_EXPLICIT: "isolated" },
        stdout: "pipe",
      });
      expect(await child.stdout.text()).toBe("isolated\n");
      expect(await child.exited).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("uses private storage roots after dropping the host variables", () => {
    const env = posterSmokeEnv("private", {
      HOME: "live",
      XDG_RUNTIME_DIR: "live",
      XDG_CONFIG_HOME: "live",
      XDG_CACHE_HOME: "live",
      XDG_DATA_HOME: "live",
      APPDATA: "live",
      LOCALAPPDATA: "live",
      USERPROFILE: "live",
    });
    expect(env).toMatchObject({
      HOME: "private",
      XDG_CONFIG_HOME: "private",
      XDG_CACHE_HOME: "private",
      XDG_DATA_HOME: "private",
      APPDATA: "private",
      LOCALAPPDATA: "private",
      USERPROFILE: "private",
      DO_NOT_TRACK: "1",
    });
    expect(env.XDG_RUNTIME_DIR).toBeUndefined();
  });

  test.each(["--terminal", "--out", "--expect"])("rejects a missing %s value", (flag) => {
    expect(() => posterSmokeOption([flag], flag)).toThrow(`${flag} requires a value`);
    expect(() => posterSmokeOption([flag, "--help"], flag)).toThrow(`${flag} requires a value`);
    expect(posterSmokeOption([], flag)).toBeUndefined();
  });

  test.each(["terminal.ansi", "report.json"])(
    "removes the profile when %s cannot be written",
    async (file) => {
      const failure = new Error(`cannot write ${file}`);
      const events: string[] = [];
      await expect(
        finishPosterSmoke(
          async () => {
            events.push("restore TTY");
          },
          async () => {
            throw failure;
          },
          () => events.push("remove profile"),
        ),
      ).rejects.toBe(failure);
      expect(events).toEqual(["restore TTY", "remove profile"]);
    },
  );

  test.each([
    ["SIGINT", 130],
    ["SIGTERM", 143],
    ["SIGHUP", 129],
  ])("cleans up a current TTY run on %s", async (signal, code) => {
    const signals = new EventEmitter();
    const events: string[] = [];
    const result = withPosterSmokeSignals(signals, async (abort) => {
      try {
        await new Promise<void>((done) =>
          abort.addEventListener(
            "abort",
            () => {
              events.push("stop child");
              done();
            },
            { once: true },
          ),
        );
        abort.throwIfAborted();
      } finally {
        await finishPosterSmoke(
          async () => {
            events.push("restore TTY");
          },
          async () => {
            events.push("write evidence");
          },
          () => events.push("remove profile"),
        );
      }
    });
    signals.emit(signal);
    expect(await result).toBe(code);
    expect(events).toEqual(["stop child", "restore TTY", "write evidence", "remove profile"]);
    expect(signals.eventNames()).toEqual([]);
  });

  test("retains the tmux home whenever shutdown is unconfirmed", async () => {
    const socket = "/private/tmux";
    for (const [code, stderr] of [
      [1, "no server running on /private/tmux"],
      [1, "error connecting to /private/tmux (No such file or directory)"],
      [0, ""],
    ] as const) {
      await stopPosterSmokeTmux(socket, async () => ({ code, stderr }));
    }
    const removed: string[] = [];
    await expect(
      runPosterSmokeTerminal(new EventEmitter(), {
        launch: () => ({ exited: Promise.resolve(0), kill: () => {} }),
        stopTmux: () => stopPosterSmokeTmux(socket, async () => ({ code: 143, stderr: "" })),
        removeHome: () => removed.push(socket),
        readEvidence: async () => {},
      }),
    ).rejects.toThrow("tmux shutdown not confirmed at /private/tmux (143)");
    expect(removed).toEqual([]);
    await expect(
      stopPosterSmokeTmux(socket, async () => ({ code: 1, stderr: "permission denied" })),
    ).rejects.toThrow("permission denied");
  });
});
