import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { decodePng } from "@/image/decode";
import {
  DownloadJobsRepository,
  getKunaiPaths,
  openKunaiDatabase,
  runMigrations,
} from "@kunai/storage";

import { onboardedConfig } from "../agent/seed";
import { storageRootEnv } from "../helpers/storage-env";
import { makeRgbPng } from "../support/image-fixtures";
import {
  hasPrintableGraphicsLeak,
  posterProtocol,
  visibleTerminalText,
} from "../support/poster-smoke-evidence";

const ROOT = resolve(import.meta.dirname, "../..");
const BUN = process.execPath;
const TARGETS = new Set(["kitty", "tmux", "xterm", "foot", "current"]);
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
};

function cleanEnv(home: string): NodeJS.ProcessEnv {
  const env = { ...process.env, ...storageRootEnv(home) };
  for (const key of Object.keys(env)) {
    if (key.startsWith("XDG_") || key === "APPDATA") delete env[key];
  }
  delete env.CI;
  delete env.CONTINUOUS_INTEGRATION;
  delete env.NO_COLOR;
  return env;
}

function commandFor(options: SmokeOptions, child: string[]): string[] {
  const { emulator, socket } = options;
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

async function captureFrame(options: SmokeOptions, name: FrameName): Promise<void> {
  const window = process.env.WINDOWID;
  if (
    options.emulator !== "current" &&
    process.env.DISPLAY &&
    window &&
    /^\d+$/.test(window) &&
    Bun.which("import")
  ) {
    const path = join(options.out, `${name}.png`);
    const deadline = Date.now() + 3_000;
    for (;;) {
      await runCommand(["import", "-window", window, `PNG24:${path}`]);
      // The terminal can acknowledge bytes before its compositor paints them.
      // Use the deterministic fixture colours to select a settled screenshot.
      if (options.expected !== "kitty-native" && options.expected !== "kitty-tmux") break;
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

async function drivePosterSmoke(options: SmokeOptions): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error("poster smoke requires a real TTY");
  const home = mkdtempSync(join(tmpdir(), "kunai-poster-profile-"));
  const env = cleanEnv(home);
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
  let signal: (() => void) | undefined;
  let protocol: string | null = null;
  let failure: string | undefined;
  let code: number | undefined;
  let stop: (() => Promise<void>) | undefined;
  const decoder = new TextDecoder();
  const cols = () => process.stdout.columns ?? 80;
  const rows = () => process.stdout.rows ?? 24;
  try {
    const paths = await seedProfile(home, env);
    const child = Bun.spawn([BUN, join(ROOT, "src/main.ts"), "--offline"], {
      cwd: ROOT,
      env,
      timeout: 55_000,
      terminal: {
        cols: cols(),
        rows: rows(),
        data(_terminal, bytes) {
          transcript += decoder.decode(bytes, { stream: true });
          process.stdout.write(bytes);
          signal?.();
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
    stop = async () => {
      process.stdin.off("readable", forwardInput);
      process.stdout.off("resize", resize);
      if (child.exitCode === null) child.kill();
      await child.exited;
      terminal.close();
    };
    void child.exited.then(() => signal?.());
    const waitFor = async (label: string, condition: () => boolean) => {
      if (condition()) return;
      if (child.exitCode !== null) throw new Error(`Kunai exited before ${label}`);
      await new Promise<void>((done, fail) => {
        const timer = setTimeout(() => {
          signal = undefined;
          fail(new Error(`timed out waiting for ${label}`));
        }, WAIT_MS);
        signal = () => {
          const ready = condition();
          if (!ready && child.exitCode === null) return;
          clearTimeout(timer);
          signal = undefined;
          if (ready) done();
          else fail(new Error(`Kunai exited before ${label}`));
        };
      });
    };
    process.stdin.setRawMode(true);
    process.stdin.on("readable", forwardInput);
    process.stdout.on("resize", resize);
    await waitFor(
      "offline library with a fixture poster",
      () => transcript.includes("Smoke Poster") && posterProtocol(transcript) !== null,
    );
    protocol = posterProtocol(transcript);
    if (options.expected && protocol !== options.expected) {
      throw new Error(`expected ${options.expected}, observed ${protocol}`);
    }
    await captureFrame(options, "first");

    const selected = transcript.length;
    terminal.write("\x1b[B");
    await waitFor(
      "poster after moving selection",
      () => posterProtocol(transcript.slice(selected)) !== null,
    );
    await captureFrame(options, "next");

    if (options.socket) {
      const beforeResize = transcript.length;
      // Decrease the font to keep the Library rail visible on narrower displays.
      await runCommand(["kitty", "@", "--to", options.socket, "set-font-size", "--", "-1"]);
      await waitFor(
        "poster after terminal resize",
        () => posterProtocol(transcript.slice(beforeResize)) !== null,
      );
      await captureFrame(options, "resized");
    }
    terminal.write("\x03");
    code = await child.exited;
    if (code !== 0 && code !== 130) throw new Error(`Kunai exited with code ${code}`);
    await captureFrame(options, "after-exit");
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
    await stop?.();
    process.stdin.setRawMode(wasRaw ?? false);
    process.stdin.pause();
    process.stdin.unref();
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
    rmSync(home, { recursive: true, force: true });
  }
}

async function main(args: string[]): Promise<void> {
  if (args[0] === "--inside") {
    const [, out, emulator, socket, expected] = args;
    if (!out || !emulator) throw new Error("missing internal smoke arguments");
    await drivePosterSmoke({ out, emulator, socket: socket || undefined, expected });
    return;
  }
  if (args.includes("--help")) {
    console.log(
      "Usage: bun run smoke:posters -- --terminal kitty|tmux|xterm|foot|current [--out NEW_DIR] [--expect PROTOCOL]",
    );
    return;
  }
  if (process.platform === "win32")
    throw new Error("the poster smoke launcher requires a POSIX PTY");
  const pick = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const emulator = pick("--terminal") ?? "current";
  if (!TARGETS.has(emulator)) throw new Error(`unsupported terminal: ${emulator}`);
  const output = pick("--out");
  const out = output ? resolve(output) : mkdtempSync(join(tmpdir(), "kunai-poster-smoke-"));
  if (output) mkdirSync(out, { mode: 0o700 });
  const expected =
    pick("--expect") ??
    (emulator === "kitty"
      ? "kitty-native"
      : emulator === "tmux"
        ? "kitty-tmux"
        : emulator === "current"
          ? undefined
          : "sixel");
  if (emulator === "current") {
    await drivePosterSmoke({ out, emulator, expected });
  } else {
    const privateHome = mkdtempSync(join(tmpdir(), "kunai-poster-terminal-"));
    const tmuxSocket = join(privateHome, "tmux");
    try {
      const env = cleanEnv(privateHome);
      for (const key of ["TMUX", "TMUX_PANE", "STY", "KITTY_WINDOW_ID", "KITTY_LISTEN_ON"])
        delete env[key];
      // foot needs the host's Wayland socket. Kunai's child environment still
      // clears every XDG variable through cleanEnv.
      if (emulator === "foot") env.XDG_RUNTIME_DIR = process.env.XDG_RUNTIME_DIR;
      const socket =
        emulator === "kitty" || emulator === "tmux" ? `unix:${join(privateHome, "kitty")}` : "";
      const inside = [BUN, import.meta.path, "--inside", out, emulator, socket, expected ?? ""];
      if (emulator === "tmux") {
        const tmuxConfig = join(privateHome, "tmux.conf");
        await Bun.write(tmuxConfig, "set -g allow-passthrough on\n");
        inside.unshift("tmux", "-S", tmuxSocket, "-f", tmuxConfig, "new-session", "-s", "posters");
      }
      await runCommandWithTty(commandFor({ emulator, out, socket }, inside), env);
      const report = await Bun.file(join(out, "report.json")).json();
      if (report.failure) throw new Error(report.failure);
    } finally {
      if (emulator === "tmux") {
        await runCommand(["tmux", "-S", tmuxSocket, "kill-server"]).catch(() => {});
      }
      rmSync(privateHome, { recursive: true, force: true });
    }
  }
  console.log(`Poster smoke evidence: ${out}`);
}

async function runCommandWithTty(args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const child = Bun.spawn(args, {
    env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    timeout: 65_000,
  });
  const code = await child.exited;
  if (code !== 0) throw new Error(`${args[0]} exited with code ${code}`);
}

if (import.meta.main) {
  await main(process.argv.slice(2)).catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
