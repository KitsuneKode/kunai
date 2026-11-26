import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { decodePng } from "@/image/decode";
import {
  DownloadJobsRepository,
  getKunaiPaths,
  openKunaiDatabase,
  runMigrations,
} from "@kunai/storage";

import { onboardedConfig } from "../agent/seed";
import { makeRgbPng } from "../support/image-fixtures";
import {
  hasPrintableGraphicsLeak,
  matchesPosterRedraw,
  posterProtocol,
  visibleTerminalText,
} from "../support/poster-smoke-evidence";
import {
  finishPosterSmoke,
  posterSmokeBunCommand,
  posterSmokeEnv,
  posterSmokeOption,
  posterSmokeWaylandEnv,
  runPosterSmokeTerminal,
  stopPosterSmokeTmux,
  withPosterSmokeSignals,
} from "../support/poster-smoke-launcher";

const ROOT = resolve(import.meta.dirname, "../..");
const TARGETS = new Map([
  ["kitty", "kitty-native"],
  ["tmux", "kitty-tmux"],
  ["xterm", "sixel"],
  ["foot", "sixel"],
  // Konsole never frees Kitty image data, so Kunai keeps it on sixel.
  ["konsole", "sixel"],
  ["wezterm", "kitty-direct"],
  ["current", undefined],
]);
const GRAPHICS_OVERRIDES = new Set([
  "KUNAI_IMAGE_PROTOCOL",
  "KUNAI_IMAGE_TMUX",
  "KUNAI_IMAGE_TRANSPORT",
  "KUNAI_IMAGE_PROBE",
]);
const WAIT_MS = 12_000;
const POSTER_COLORS = [
  [237, 48, 84],
  [56, 200, 110],
] as const;

type SmokeOptions = {
  readonly emulator: string;
  readonly out: string;
  readonly socket?: string;
  readonly expected?: string;
  readonly terminalHome?: string;
};

function commandFor(options: SmokeOptions, child: string[]): string[] {
  const { emulator, socket, terminalHome } = options;
  if (emulator === "kitty" || emulator === "tmux") {
    if (!socket) throw new Error("Kitty requires the harness's private control socket");
    return [
      "kitty",
      "--config",
      "NONE",
      "--listen-on",
      socket,
      "-o",
      "allow_remote_control=socket-only",
      "-o",
      "remember_window_size=no",
      "-o",
      "initial_window_width=132c",
      "-o",
      "initial_window_height=42c",
      ...child,
    ];
  }
  if (emulator === "xterm") return ["xterm", "-ti", "vt340", "-geometry", "132x42", "-e", ...child];
  if (emulator === "foot")
    return ["foot", "--config=/dev/null", "--window-size-chars=132x42", ...child];
  if (emulator === "konsole")
    return [
      "konsole",
      "--separate",
      "-p",
      "TerminalColumns=132",
      "-p",
      "TerminalRows=42",
      "-e",
      ...child,
    ];
  if (emulator === "wezterm" && terminalHome)
    return [
      "wezterm",
      "--skip-config",
      "--config",
      "enable_kitty_graphics=true",
      "--config",
      "initial_cols=132",
      "--config",
      "initial_rows=42",
      "start",
      "--always-new-process",
      "--class",
      basename(terminalHome),
      "--",
      ...child,
    ];
  return child;
}

async function runCommand(args: string[], env = process.env): Promise<string> {
  const child = Bun.spawn(args, { env, stdout: "pipe", stderr: "pipe", timeout: 5_000 });
  const [stdout, stderr, code] = await Promise.all([
    child.stdout.text(),
    child.stderr.text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`${args[0]} failed (${code}): ${stderr.trim()}`);
  return stdout;
}

async function seedProfile(home: string, env: NodeJS.ProcessEnv) {
  const paths = getKunaiPaths({ homeDir: home, env });
  mkdirSync(paths.configDir, { recursive: true, mode: 0o700 });
  await Bun.write(paths.configPath, JSON.stringify(onboardedConfig()));
  const db = openKunaiDatabase(paths.dataDbPath);
  try {
    runMigrations(db, "data");
    const jobs = new DownloadJobsRepository(db);
    const now = new Date().toISOString();
    for (const [index, color] of POSTER_COLORS.entries()) {
      const id = `poster-fixture-${index}`;
      const outputPath = join(home, `${id}.mp4`);
      const thumbnailPath = join(home, `${id}.png`);
      await Promise.all([
        Bun.write(outputPath, "offline artifact for poster smoke; never played"),
        Bun.write(
          thumbnailPath,
          makeRgbPng(
            80,
            120,
            Array.from({ length: 80 * 120 * 3 }, (_, i) => color[i % 3] ?? 0),
          ),
        ),
      ]);
      jobs.enqueue({
        id,
        titleId: `tmdb:${900001 + index}`,
        titleName: `Smoke Poster ${index + 1}`,
        mediaKind: "movie",
        contentType: "movie",
        providerId: "videasy",
        mode: "series",
        streamUrl: "https://example.invalid/poster-smoke.mp4",
        headers: {},
        outputPath,
        tempPath: `${outputPath}.part`,
        createdAt: now,
        updatedAt: now,
      });
      const claim = jobs.markRunning(id, now);
      if (
        !claim ||
        !jobs.updateOfflineMetadata(id, { thumbnailPath }, now, claim) ||
        !jobs.complete(id, now, claim)
      )
        throw new Error("could not seed poster fixture");
    }
  } finally {
    db.close();
  }
  return paths;
}

type FrameName = "first" | "next" | "resized" | "after-exit";

function showsColor(rgba: Uint8Array, color: readonly [number, number, number]): boolean {
  let matches = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (
      rgba[i] === color[0] &&
      rgba[i + 1] === color[1] &&
      rgba[i + 2] === color[2] &&
      ++matches >= 128
    )
      return true;
  }
  return false;
}

async function captureFrame(
  options: SmokeOptions,
  name: FrameName,
  abort: AbortSignal,
): Promise<void> {
  abort.throwIfAborted();
  const window = await screenshotWindow(options);
  if (window) {
    const path = join(options.out, `${name}.png`);
    const deadline = Date.now() + 3_000;
    for (;;) {
      await runCommand(["import", "-window", window, `PNG24:${path}`]);
      abort.throwIfAborted();
      // The terminal can acknowledge bytes before its compositor paints them.
      // Use the deterministic fixture colours to select a settled screenshot.
      if (!options.expected?.startsWith("kitty-")) break;
      const { rgba } = decodePng(await Bun.file(path).bytes());
      const first = showsColor(rgba, POSTER_COLORS[0]);
      const second = showsColor(rgba, POSTER_COLORS[1]);
      if (
        name === "after-exit"
          ? !first && !second
          : name === "first"
            ? first && !second
            : second && !first
      )
        break;
      if (Date.now() >= deadline)
        throw new Error(`fixture pixels did not settle in the ${name} frame`);
    }
  }
  let frame = "";
  if (options.socket) {
    frame = await runCommand([
      "kitty",
      "@",
      "--to",
      options.socket,
      "get-text",
      "--extent",
      "screen",
    ]);
  } else if (options.emulator === "tmux") {
    frame = await runCommand(["tmux", "capture-pane", "-p"]);
  }
  if (frame) {
    await Bun.write(join(options.out, `${name}.txt`), frame);
    if (hasPrintableGraphicsLeak(frame))
      throw new Error(`graphics escape leaked into the ${name} frame`);
  }
}

async function screenshotWindow(options: SmokeOptions): Promise<string | undefined> {
  if (options.emulator === "current" || !process.env.DISPLAY || !Bun.which("import")) return;
  const window = process.env.WINDOWID;
  if (window && /^[1-9]\d*$/.test(window)) return window;
  // WezTerm does not export an X11 WINDOWID. Find only this run's window.
  if (
    options.emulator === "wezterm" &&
    options.terminalHome &&
    !process.env.WAYLAND_DISPLAY &&
    Bun.which("xdotool")
  ) {
    const windows = await runCommand([
      "xdotool",
      "search",
      "--onlyvisible",
      "--class",
      `^${basename(options.terminalHome)}$`,
    ]);
    const id = windows.trim();
    if (!/^[1-9]\d*$/.test(id)) throw new Error("expected one private WezTerm X11 window");
    return id;
  }
}

async function drivePosterSmoke(options: SmokeOptions, abort: AbortSignal): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error("poster smoke requires a real TTY");
  const home = mkdtempSync(join(options.terminalHome ?? tmpdir(), "kunai-poster-profile-"));
  const env = posterSmokeEnv(home);
  for (const key of Object.keys(env)) {
    if (
      key.startsWith("KUNAI_") &&
      key !== "KUNAI_CREDENTIAL_BACKEND" &&
      !GRAPHICS_OVERRIDES.has(key)
    )
      delete env[key];
  }
  Object.assign(env, {
    KUNAI_COMPILED_SMOKE: "1",
    KUNAI_COMPILED_SMOKE_FIXTURE: join(ROOT, "src/app/compiled-smoke/fixture-provider.ts"),
    KUNAI_DISABLE_EXTERNAL_URL: "1",
    KUNAI_REDUCED_MOTION: "1",
    KUNAI_PET: "off",
  });

  const wasRaw = process.stdin.isRaw;
  let transcript = "";
  let wake: (() => void) | undefined;
  let protocol: string | null = null;
  let failure: string | undefined;
  let code: number | undefined;
  let stop: (() => Promise<void>) | undefined;
  const decoder = new TextDecoder();
  const cols = () => process.stdout.columns ?? 80;
  const rows = () => process.stdout.rows ?? 24;
  try {
    const paths = await seedProfile(home, env);
    abort.throwIfAborted();
    const child = Bun.spawn(posterSmokeBunCommand(join(ROOT, "src/main.ts"), "--offline"), {
      cwd: ROOT,
      env,
      timeout: 55_000,
      terminal: {
        cols: cols(),
        rows: rows(),
        data(_terminal, bytes) {
          transcript += decoder.decode(bytes, { stream: true });
          process.stdout.write(bytes);
          wake?.();
        },
      },
    });
    const terminal = child.terminal;
    if (!terminal) throw new Error("could not allocate a PTY for Kunai");
    function forwardInput(): void {
      let bytes: Uint8Array | string | null;
      while ((bytes = process.stdin.read()) !== null) terminal?.write(bytes);
    }
    const resize = () => terminal.resize(cols(), rows());
    const interrupt = () => {
      if (child.exitCode === null) child.kill();
      wake?.();
    };
    abort.addEventListener("abort", interrupt, { once: true });
    stop = async () => {
      abort.removeEventListener("abort", interrupt);
      process.stdin.off("readable", forwardInput);
      process.stdout.off("resize", resize);
      if (!abort.aborted && child.exitCode === null) child.kill();
      await child.exited;
      terminal.close();
    };
    void child.exited.then(() => wake?.());
    const waitFor = async (label: string, condition: () => boolean) => {
      await new Promise<void>((done, fail) => {
        const timer = setTimeout(() => {
          wake = undefined;
          fail(new Error(`timed out waiting for ${label}`));
        }, WAIT_MS);
        wake = () => {
          try {
            abort.throwIfAborted();
            if (!condition()) {
              if (child.exitCode === null) return;
              throw new Error(`Kunai exited before ${label}`);
            }
            done();
          } catch (error) {
            fail(error);
          }
          clearTimeout(timer);
          wake = undefined;
        };
        wake();
      });
    };
    process.stdin.setRawMode(true);
    process.stdin.on("readable", forwardInput);
    process.stdout.on("resize", resize);
    await waitFor(
      "offline library with a fixture poster",
      () => transcript.includes("Smoke Poster") && posterProtocol(transcript) !== null,
    );
    const startup = posterProtocol(transcript);
    if (startup === null) throw new Error("startup poster protocol was not observed");
    protocol = startup;
    if (options.expected && startup !== options.expected) {
      throw new Error(`expected ${options.expected}, observed ${startup}`);
    }
    await captureFrame(options, "first", abort);

    const selected = transcript.length;
    terminal.write("\x1b[B");
    await waitFor("poster after moving selection", () =>
      matchesPosterRedraw("selection", startup, transcript.slice(selected)),
    );
    await captureFrame(options, "next", abort);

    if (options.socket) {
      const beforeResize = transcript.length;
      // Decrease the font to keep the Library rail visible on narrower displays.
      await runCommand(["kitty", "@", "--to", options.socket, "set-font-size", "--", "-1"]);
      await waitFor("poster after terminal resize", () =>
        matchesPosterRedraw("resize", startup, transcript.slice(beforeResize)),
      );
      await captureFrame(options, "resized", abort);
    }
    terminal.write("\x03");
    code = await child.exited;
    abort.throwIfAborted();
    if (code !== 0 && code !== 130) throw new Error(`Kunai exited with code ${code}`);
    await captureFrame(options, "after-exit", abort);
    if (hasPrintableGraphicsLeak(transcript))
      throw new Error("graphics escape leaked into printable transcript text");
    const config = await Bun.file(paths.configPath).json();
    if (config.installId || config.analytics !== "disabled") {
      throw new Error("disposable profile changed analytics consent or identity");
    }
    const db = openKunaiDatabase(paths.dataDbPath, { readonly: true, create: false });
    try {
      if (new DownloadJobsRepository(db).listCompleted().length !== 2) {
        throw new Error("offline fixture rows did not survive the smoke");
      }
    } finally {
      db.close();
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    await finishPosterSmoke(
      async () => {
        try {
          await stop?.();
        } finally {
          process.stdin.setRawMode(wasRaw ?? false);
          process.stdin.pause();
          process.stdin.unref();
        }
      },
      async () => {
        await Bun.write(join(options.out, "terminal.ansi"), transcript);
        await Bun.write(
          join(options.out, "report.json"),
          JSON.stringify(
            {
              os: process.platform,
              terminal: options.emulator,
              protocol,
              exitCode: code,
              failure,
              visibleTail: visibleTerminalText(transcript).slice(-1200),
            },
            null,
            2,
          ),
        );
      },
      () => rmSync(home, { recursive: true, force: true }),
    );
  }
}

async function main(args: string[]): Promise<void> {
  if (args[0] === "--inside") {
    const [, out, emulator, socket, expected, terminalHome] = args;
    if (!out || !emulator || !terminalHome) throw new Error("missing internal smoke arguments");
    const code = await withPosterSmokeSignals(process, (abort) =>
      drivePosterSmoke(
        { out, emulator, socket: socket || undefined, expected, terminalHome },
        abort,
      ),
    );
    if (code) process.exitCode = code;
    return;
  }
  const emulator = posterSmokeOption(args, "--terminal") ?? "current";
  const output = posterSmokeOption(args, "--out");
  const expected = posterSmokeOption(args, "--expect") ?? TARGETS.get(emulator);
  if (args.includes("--help")) {
    console.log(
      `Usage: bun run smoke:posters -- --terminal ${[...TARGETS.keys()].join("|")} [--out NEW_DIR] [--expect PROTOCOL]`,
    );
    return;
  }
  if (process.platform === "win32")
    throw new Error("the poster smoke launcher requires a POSIX PTY");
  if (!TARGETS.has(emulator)) throw new Error(`unsupported terminal: ${emulator}`);
  const binaries = emulator === "tmux" ? ["tmux", "kitty"] : [emulator];
  const missing =
    emulator === "current" ? undefined : binaries.find((binary) => !Bun.which(binary));
  if (missing) {
    console.log(`Skipping ${emulator} poster smoke: ${missing} is not installed.`);
    return;
  }
  const out = output ? resolve(output) : mkdtempSync(join(tmpdir(), "kunai-poster-smoke-"));
  if (output) mkdirSync(out, { mode: 0o700 });
  const options = { out, emulator, expected };
  const code =
    emulator === "current"
      ? await withPosterSmokeSignals(process, (abort) => drivePosterSmoke(options, abort))
      : await launchSmoke(options);
  if (code) {
    process.exitCode = code;
    return;
  }
  console.log(`Poster smoke evidence: ${out}`);
}

async function launchSmoke({ emulator, out, expected }: SmokeOptions): Promise<number> {
  const terminalHome = mkdtempSync(join(tmpdir(), "kunai-poster-terminal-"));
  const tmuxSocket = join(terminalHome, "tmux");
  return runPosterSmokeTerminal(process, {
    launch: () => {
      const env = posterSmokeEnv(terminalHome);
      for (const key of [
        "TMUX",
        "TMUX_PANE",
        "STY",
        "ZELLIJ",
        "ZELLIJ_SESSION_NAME",
        "KITTY_WINDOW_ID",
        "KITTY_LISTEN_ON",
        "KONSOLE_VERSION",
        "TERM_PROGRAM",
        "TERM_PROGRAM_VERSION",
        "WEZTERM_UNIX_SOCKET",
        "WEZTERM_PANE",
        "WINDOWID",
        "WAYLAND_DISPLAY",
        "WAYLAND_SOCKET",
      ])
        delete env[key];
      // Only the emulator needs access to the host's Wayland socket.
      Object.assign(env, posterSmokeWaylandEnv(process.env));
      // Kitty stores its cache in $XDG_CACHE_HOME/kitty inside the private home.
      const socket =
        emulator === "kitty" || emulator === "tmux"
          ? `unix:${join(terminalHome, "kitty.sock")}`
          : "";
      const inside = posterSmokeBunCommand(
        import.meta.path,
        "--inside",
        out,
        emulator,
        socket,
        expected ?? "",
        terminalHome,
      );
      if (emulator === "tmux") {
        const tmuxConfig = join(terminalHome, "tmux.conf");
        writeFileSync(tmuxConfig, "set -g allow-passthrough on\n");
        inside.unshift("tmux", "-S", tmuxSocket, "-f", tmuxConfig, "new-session", "-s", "posters");
      }
      return Bun.spawn(commandFor({ emulator, out, socket, terminalHome }, inside), {
        env,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        timeout: 65_000,
      });
    },
    stopTmux: async () => {
      if (emulator === "tmux") {
        await stopPosterSmokeTmux(tmuxSocket);
      }
    },
    removeHome: () => rmSync(terminalHome, { recursive: true, force: true }),
    readEvidence: async () => {
      const report = await Bun.file(join(out, "report.json")).json();
      if (report.failure) throw new Error(report.failure);
    },
  });
}

if (import.meta.main) {
  await main(process.argv.slice(2)).catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
