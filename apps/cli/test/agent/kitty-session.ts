import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { DEFAULT_CONFIG } from "@kunai/config";
import type { JsonValue } from "@kunai/types";
import { z } from "zod";

import {
  createIsolatedCliProfile,
  disposeIsolatedCliProfile,
} from "../integration/helpers/isolated-container";
import { createProfileInspector } from "./profile-inspector";
import { onboardedConfig } from "./seed";

const CLI_ROOT = resolve(import.meta.dir, "../..");
const MAIN = join(CLI_ROOT, "src/main.ts");
export const PLAYBACK_ADVANCE_SECONDS = 8;

/** Condition polling for a live external process, never a fixed sleep assertion. */
export async function waitForKittyCondition<T>(
  read: () => Promise<T | null>,
  timeoutMs = 15_000,
  signal?: AbortSignal,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  do {
    signal?.throwIfAborted();
    const result = await read();
    signal?.throwIfAborted();
    if (result !== null) return result;
    await new Promise<void>((done) => setTimeout(done, 100));
  } while (Date.now() < deadline);
  throw new Error("Kitty observation deadline exceeded");
}

/** Kept separate from desktop clicks: these are terminal mouse-protocol bytes. */
export function kittyMouseReport(x: number, y: number, release = false): string {
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 1 || y < 1) {
    throw new Error("Mouse coordinates must be positive terminal cells");
  }
  return `\x1b[<0;${x};${y}${release ? "m" : "M"}`;
}

/** Resolve one visible label to terminal cells; ambiguous labels cannot authorize a click. */
export function kittyTextTarget(frame: string, label: string) {
  if (!label || frame.split(label).length !== 2)
    throw new Error("Click label must be uniquely visible");
  const lines = frame.split("\n");
  const y = lines.findIndex((line) => line.includes(label));
  const line = lines[y];
  if (!line) throw new Error("Click target row disappeared");
  return { x: Bun.stringWidth(line.slice(0, line.indexOf(label))) + 1, y: y + 1 };
}

/** Playback clock/dimensions only; a cover image can pass. Inspect actual frame captures separately. */
export function playbackProgressProof(start: number, end: number, video: JsonValue) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start + PLAYBACK_ADVANCE_SECONDS)
    throw new Error("Playback did not advance");
  return {
    timePosStart: start,
    timePosEnd: end,
    video: z.object({ w: z.number().positive(), h: z.number().positive() }).parse(video),
  };
}

/**
 * Own one Kitty window, private storage roots and evidence directory. Live runs
 * require a provider pin; startup failure cleans up before rejecting, while
 * unconfirmed child exit retains the profile for investigation.
 */
export async function startKittySession(options: {
  readonly evidenceDir: string;
  readonly argv?: readonly string[];
  readonly providerId?: string;
  readonly providerIds?: readonly string[];
  readonly fixture?: boolean;
  readonly requiresMpv?: boolean;
  readonly font?: string;
  readonly signal?: AbortSignal;
}) {
  options.signal?.throwIfAborted();
  if (
    !options.fixture &&
    (!options.providerId || !options.providerIds?.includes(options.providerId))
  ) {
    throw new Error(
      "Live Kitty verification requires an explicit production provider pin and roster",
    );
  }
  if (process.platform === "win32") throw new Error("Kitty driver requires a Unix desktop");
  const kitty = Bun.which("kitty");
  const bun = Bun.which("bun");
  const realMpv = Bun.which("mpv");
  if (!kitty || !bun) throw new Error("Kitty and Bun are required");
  if (options.requiresMpv && !realMpv) throw new Error("Decoded playback requires installed mpv");
  const kittyExecutable = kitty;
  const bunExecutable = bun;
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY)
    throw new Error("No graphical desktop available");
  const evidenceDir = resolve(options.evidenceDir);
  mkdirSync(evidenceDir, { mode: 0o700 }); // Refuse to overwrite any previous evidence.
  const profile = createIsolatedCliProfile("kitty");
  const socket = join(profile.rootDir, "control");
  const socketRecord = join(profile.rootDir, "mpv.json");
  const applicationRecord = join(profile.rootDir, "application.pid");
  let windowId: number | null = null;
  let applicationPid: number | null = null;
  let stopPromise: Promise<void> | undefined;
  let captureNumber = 0;
  const captures: { label: string; filename: string }[] = [];
  const environment: Record<string, string> = {};
  /** Setup is synchronous: every throw before returning the child disposes the profile. */
  function launchTerminal() {
    try {
      chmodSync(profile.rootDir, 0o700);
      const config = { ...DEFAULT_CONFIG, ...onboardedConfig() };
      if (!options.fixture) {
        config.provider = DEFAULT_CONFIG.provider;
        config.animeProvider = DEFAULT_CONFIG.animeProvider;
      }
      if (options.providerId)
        Object.assign(config, {
          provider: options.providerId,
          animeProvider: options.providerId,
          youtubeProvider: options.providerId,
          providerPriority: [],
          animeProviderPriority: [],
          youtubeProviderPriority: [],
          disabledProviders: options.providerIds?.filter((id) => id !== options.providerId) ?? [],
        });
      writeFileSync(profile.paths.configPath, JSON.stringify(config));
      const shim = join(profile.rootDir, "bin");
      mkdirSync(shim);
      if (realMpv) {
        // Record only the IPC endpoint, never stream URLs, headers or command lines.
        writeFileSync(
          join(shim, "mpv"),
          `#!${bun}\nconst args=process.argv.slice(2);\nconst endpoint=args.find(a=>a.startsWith('--input-ipc-server='))?.split('=').slice(1).join('=');\nconst child=Bun.spawn([${JSON.stringify(realMpv)},...args,'--mute=yes'],{stdin:'ignore',stdout:'inherit',stderr:'inherit'});\nif(endpoint) await Bun.write(${JSON.stringify(socketRecord)},JSON.stringify({socket:endpoint,pid:child.pid}));\nfor(const event of ['SIGTERM','SIGINT','SIGHUP']) process.on(event,()=>child.kill());\nprocess.exit(await child.exited);\n`,
          { mode: 0o755 },
        );
      }
      for (const key of [
        "HOME",
        "PATH",
        "DISPLAY",
        "WAYLAND_DISPLAY",
        "XDG_RUNTIME_DIR",
        "DBUS_SESSION_BUS_ADDRESS",
        "LANG",
        "XAUTHORITY",
      ]) {
        const value = process.env[key];
        if (value) environment[key] = value;
      }
      const childEnv = {
        ...profile.env,
        PATH: `${shim}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        COLORTERM: "truecolor",
        FORCE_COLOR: "3",
        KUNAI_POSTER: "1",
      };
      if (options.fixture)
        Object.assign(childEnv, {
          KUNAI_COMPILED_SMOKE: "1",
          KUNAI_COMPILED_SMOKE_FIXTURE: join(
            CLI_ROOT,
            "src/app/compiled-smoke/fixture-provider.ts",
          ),
        });
      const envArgs = Object.entries(childEnv).map(([key, value]) => `${key}=${value}`);
      return Bun.spawn(
        [
          kittyExecutable,
          "--config",
          "NONE",
          "--listen-on",
          `unix:${socket}`,
          "--class",
          "kunai-verification",
          "--title",
          "Kunai verification — isolated profile",
          "-o",
          "allow_remote_control=socket-only",
          "-o",
          "confirm_os_window_close=0",
          "-o",
          `font_family=${options.font ?? "DankMono Nerd Font Mono"}`,
          "-o",
          "font_size=14.5",
          "-o",
          "initial_window_width=120c",
          "-o",
          "initial_window_height=36c",
          "/usr/bin/env",
          ...envArgs,
          "/bin/sh",
          "-c",
          'umask 077; printf "%s\\n" "$$" > "$1" || exit 1; shift; exec "$@"',
          "kunai-owned-command",
          applicationRecord,
          bunExecutable,
          MAIN,
          ...(options.argv ?? []),
        ],
        {
          cwd: profile.rootDir,
          env: environment,
          stdin: "ignore",
          stdout: "ignore",
          stderr: Bun.file(join(evidenceDir, "terminal.log")),
        },
      );
    } catch (error) {
      disposeIsolatedCliProfile(profile);
      throw error;
    }
  }
  const terminal = launchTerminal();
  /** Invoke only this session's remote socket, with bounded command execution. */
  async function remote(args: readonly string[], input?: string): Promise<string> {
    const proc = Bun.spawn([kittyExecutable, "@", "--to", `unix:${socket}`, ...args], {
      env: environment,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10_000,
    });
    if (input) proc.stdin.write(input);
    proc.stdin.end();
    const [code, out, error] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    if (code !== 0) throw new Error(`Kitty ${args[0]} failed: ${error.trim()}`);
    return out;
  }
  const match = () => {
    if (windowId === null) throw new Error("Kitty window not ready");
    return ["--match", `id:${windowId}`];
  };
  const text = () => remote(["get-text", ...match(), "--extent", "screen"]);
  const sendText = (value: string) => remote(["send-text", ...match(), "--stdin"], value);
  /** Capture terminal text, actual graphics and persisted state without approving the picture. */
  async function capture(label: string) {
    if (!/^[a-z0-9-]+$/.test(label)) throw new Error("Capture labels must be simple filenames");
    const filename = `${String(++captureNumber).padStart(3, "0")}-${label}`;
    const frame = await text();
    await Bun.write(join(evidenceDir, `${filename}.txt`), frame);
    await remote(["screenshot", ...match(), join(evidenceDir, `${filename}.png`)]);
    const inspector = createProfileInspector(profile.paths);
    await Bun.write(
      join(evidenceDir, `${filename}-backend.json`),
      JSON.stringify({ history: inspector.history(), queue: inspector.queue() }),
    );
    captures.push({ label, filename });
    await Bun.write(join(evidenceDir, "captures.json"), JSON.stringify(captures));
    return frame;
  }
  /** Send one bounded IPC command to the mpv endpoint recorded by this session's shim. */
  async function ipc(command: readonly (string | number)[]): Promise<JsonValue> {
    const record = z
      .object({ socket: z.string().min(1) })
      .parse(await Bun.file(socketRecord).json());
    return new Promise((done, reject) => {
      let buffer = "";
      let connection: Awaited<ReturnType<typeof Bun.connect>> | undefined;
      let settled = false;
      const finish = (error?: Error, value: JsonValue = null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        connection?.end();
        if (error) {
          reject(error);
          return;
        }
        done(value);
      };
      const operation = command[0] === "get_property" ? `${command[0]} ${command[1]}` : command[0];
      const timer = setTimeout(
        () => finish(new Error(`mpv IPC deadline exceeded: ${operation}`)),
        2000,
      );
      void Bun.connect({
        unix: record.socket,
        socket: {
          open(client) {
            if (settled) {
              client.end();
              return;
            }
            connection = client;
            client.write(JSON.stringify({ command, request_id: 42 }) + "\n");
          },
          data(_client, bytes) {
            buffer += bytes.toString();
            if (buffer.length > 65_536) {
              finish(new Error("mpv IPC response exceeded bound"));
              return;
            }
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              try {
                const response = z
                  .object({
                    request_id: z.number().optional(),
                    error: z.string().optional(),
                    data: z.json().optional(),
                  })
                  .parse(JSON.parse(line));
                if (response.request_id === 42)
                  finish(
                    response.error === "success" ? undefined : new Error("mpv command rejected"),
                    response.data ?? null,
                  );
              } catch {
                finish(new Error("Invalid mpv IPC response"));
              }
            }
          },
          error(_client, error) {
            finish(error);
          },
          connectError(_client, error) {
            finish(error);
          },
        },
      }).catch(finish);
    });
  }
  /** All callers share cleanup completion, including signals racing the runner's finally. */
  function stop(): Promise<void> {
    return (stopPromise ??= stopOwnedSession());
  }
  /** Close owned processes, inspect analytics isolation, then dispose only after confirmed child exit. */
  async function stopOwnedSession() {
    let privateStateClean = true;
    let childrenExited = true;
    try {
      if (windowId !== null) {
        await remote(["send-key", ...match(), "ctrl+c"]).catch(() => {});
        await ipc(["quit"]).catch(() => {});
        await remote(["close-window", ...match()]).catch(() => {});
      }
    } finally {
      // Kitty can be interrupted before remote `ls` discovers its foreground
      // command. The private wrapper records that same PID before execing Bun.
      const recordedApplicationPid = z.coerce
        .number()
        .int()
        .positive()
        .safeParse(
          await Bun.file(applicationRecord)
            .text()
            .catch(() => ""),
        );
      const applicationPids = new Set([
        ...(applicationPid === null ? [] : [applicationPid]),
        ...(recordedApplicationPid.success ? [recordedApplicationPid.data] : []),
      ]);
      childrenExited = applicationPids.size > 0;
      for (const pid of applicationPids) {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          // Exit is confirmed below; a failed signal is never proof of exit.
        }
      }
      terminal.kill();
      await terminal.exited;
      const mpvRecord = z.object({ pid: z.number().int().positive() }).safeParse(
        await Bun.file(socketRecord)
          .json()
          .catch(() => null),
      );
      const childPids = [...applicationPids, ...(mpvRecord.success ? [mpvRecord.data.pid] : [])];
      if (mpvRecord.success) {
        try {
          process.kill(mpvRecord.data.pid, "SIGTERM");
        } catch {
          // As with the app, the subsequent observation decides cleanup safety.
        }
      }
      try {
        await waitForKittyCondition(async () => {
          for (const pid of childPids) {
            try {
              process.kill(pid, 0);
              return null;
            } catch (error) {
              if (!(error instanceof Error && "code" in error && error.code === "ESRCH"))
                return null;
            }
          }
          return true;
        }, 3000);
      } catch {
        childrenExited = false;
      }
      const saved = createProfileInspector(profile.paths).config();
      privateStateClean = saved.analytics !== "enabled" && !saved.installId;
      await Bun.write(
        join(evidenceDir, "cleanup.json"),
        JSON.stringify({
          privateStateClean,
          terminalExited: true,
          childrenExited,
          profileRetained: !childrenExited,
        }),
      );
      if (childrenExited) disposeIsolatedCliProfile(profile);
    }
    if (!privateStateClean) throw new Error("Verification created analytics consent or identity");
    if (!childrenExited) throw new Error("Owned child exit unconfirmed; isolated profile retained");
  }
  try {
    await waitForKittyCondition(
      async () => {
        if (terminal.exitCode !== null)
          throw new Error("Owned Kitty exited before readiness; inspect terminal.log");
        try {
          const windows = z
            .array(
              z.object({
                tabs: z.array(
                  z.object({
                    windows: z.array(
                      z.object({
                        id: z.number().int().positive(),
                        pid: z.number().int().positive(),
                      }),
                    ),
                  }),
                ),
              }),
            )
            .parse(JSON.parse(await remote(["ls"])));
          const found = windows[0]?.tabs?.[0]?.windows?.[0];
          if (!found) return null;
          windowId = found.id;
          applicationPid = found.pid;
          return true;
        } catch {
          return null;
        }
      },
      15_000,
      options.signal,
    );
  } catch (error) {
    await stop();
    throw error;
  }
  return {
    profile,
    evidenceDir,
    pid: terminal.pid,
    text,
    capture,
    sendText,
    key: (key: string) => remote(["send-key", ...match(), key]),
    async clickText(label: string) {
      const frame = await capture("before-click");
      const { x, y } = kittyTextTarget(frame, label);
      await sendText(kittyMouseReport(x, y));
      await sendText(kittyMouseReport(x, y, true));
      return { x, y, inputRoute: "SGR injected into PTY" };
    },
    waitForText: (literal: string, timeoutMs?: number) =>
      waitForKittyCondition(
        async () => ((await text()).includes(literal) ? true : null),
        timeoutMs,
        options.signal,
      ),
    ipc,
    stop,
  };
}
