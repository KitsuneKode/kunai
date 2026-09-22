/**
 * L3 agent driver — runs the REAL `src/main.ts` inside a real PTY under tmux,
 * sends real keystrokes through tmux's input path, and reads the rendered pane
 * with `capture-pane` — the actual screen a user sees, colors and all. SQLite
 * truth comes from the same seeded profile the app is writing to.
 *
 * Why tmux and not a piped child process: `main.ts` gates on TTY (setup
 * wizard, Ink raw-mode input, alt-screen). `tmux send-keys` types through the
 * terminal layer exactly like a human; `capture-pane` reads the composed
 * screen rather than the output stream, so Ink's alt-screen/redraw model needs
 * no special handling. `remain-on-exit` keeps the final frame readable after
 * the app exits, and `pane_dead` tells us the process really quit.
 *
 * What it deliberately is NOT: an in-process test. Each operation is a fresh
 * `tmux` CLI call — the held state is the tmux session itself, so the driver
 * is naturally safe across agent turns and survives the caller dying
 * (`kunai-agent session stop` is the entire cleanup path).
 *
 * Platform: tmux only exists on Linux/macOS — call sites gate with
 * `Bun.which("tmux")` and land in the skip line, never the failure line.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { stripAnsi } from "../harness/render-capture";
import {
  createIsolatedCliProfile,
  disposeIsolatedCliProfile,
  type IsolatedCliProfile,
} from "../integration/helpers/isolated-container";
import {
  createProfileInspector,
  diffSnapshots,
  type ProfileDelta,
  type ProfileInspector,
  type ProfileSnapshot,
} from "./profile-inspector";
import { onboardedConfig } from "./seed";

const CLI_ROOT = resolve(import.meta.dirname, "../..");
const FIXTURE_PROVIDER = resolve(CLI_ROOT, "src/app/compiled-smoke/fixture-provider.ts");
const FAKE_MPV_BIN = resolve(CLI_ROOT, "test/integration/helpers/fake-mpv-bin.ts");

export interface TmuxSessionOptions {
  /** tmux session name — also the sidecar state filename. */
  readonly name?: string;
  readonly columns?: number;
  readonly rows?: number;
  /** Seeded onboarded config by default; "fresh" lands in the setup wizard. */
  readonly seed?: "onboarded" | "fresh";
  /** Extra env for the launched process (KUNAI_* seams, PATH overrides). */
  readonly env?: Record<string, string>;
  /** PATH-shim fake mpv (default true — the real-mpv tier sets this false). */
  readonly fakeMpv?: boolean;
  readonly fakeMpvMode?: "normal" | "fail-pre-loaded" | "hold";
  /**
   * Command override — default `bun src/main.ts`. The compiled-binary tier
   * passes the built binary path here; everything else stays identical.
   */
  readonly command?: string;
  /** Keep the sandbox after stop() (for post-mortem inspection). */
  readonly keepProfile?: boolean;
  /**
   * Caller-provided sandbox — created via createIsolatedCliProfile by the
   * caller when it must place files inside the profile BEFORE launch (the
   * real-mpv tier drops media + a wrapper bin in first). Seeding still
   * applies unless `seed: "fresh"`.
   */
  readonly profile?: IsolatedCliProfile;
  /** Extra PATH entries prepended before the defaults (real-mpv wrapper dir). */
  readonly pathPrefix?: string;
}

export interface TmuxSession {
  readonly name: string;
  readonly profile: IsolatedCliProfile;
  /** The tmux target (`name`). */
  readonly target: string;
  /** Send keys; consecutive literals batch into one send-keys -l call. */
  send(...keys: string[]): Promise<void>;
  /** Current visible pane, ANSI-stripped. */
  see(): Promise<string>;
  /** Current visible pane with color escapes preserved. */
  seeRaw(): Promise<string>;
  waitFor(pred: (frame: string) => boolean, label?: string, timeoutMs?: number): Promise<void>;
  waitSettled(): Promise<void>;
  /** True once the launched process exited (remain-on-exit keeps the pane). */
  isDead(): Promise<boolean>;
  /** Quit via Ctrl+C through the real input path, wait for process death. */
  quit(): Promise<void>;
  /** Quit then relaunch the same profile — "close it and open it again". */
  relaunch(): Promise<void>;
  inspect(): ProfileInspector;
  snapshot(): ProfileSnapshot;
  diffSince(before: ProfileSnapshot): ProfileDelta;
  /** Kill the tmux session and (unless keepProfile) delete the sandbox. */
  stop(): Promise<void>;
}

function tmuxAvailable(): boolean {
  return Bun.which("tmux") !== null;
}

async function tmux(args: string[]): Promise<string> {
  const proc = Bun.spawn(["tmux", ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`tmux ${args[0]} failed (${code}): ${err.trim() || out.trim()}`);
  }
  return out;
}

const SETTLE_POLLS = 3;
const SETTLE_TIMEOUT_MS = 15_000;
const DEATH_TIMEOUT_MS = 15_000;

/** Session names become tmux session names AND sidecar filenames. */
const SESSION_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

function assertSessionName(name: string): void {
  if (!SESSION_NAME_PATTERN.test(name)) {
    throw new Error(
      `invalid session name ${JSON.stringify(name)} — use letters, digits, "_" or "-" ` +
        `(it becomes a tmux session name and a tmp filename)`,
    );
  }
}

/** tmux send-keys accepts key NAMES for control keys; literals need `-l`. */
const TMUX_KEY_NAMES: Record<string, string> = {
  "\r": "Enter",
  "\x1b": "Escape",
  "\t": "Tab",
  " ": "Space",
  "\x7f": "BSpace",
  "\x1b[A": "Up",
  "\x1b[B": "Down",
  "\x1b[C": "Right",
  "\x1b[D": "Left",
  "\x03": "C-c",
};

export async function startTmuxSession(options: TmuxSessionOptions = {}): Promise<TmuxSession> {
  if (!tmuxAvailable()) {
    throw new Error("tmux is not installed — L3 driver requires tmux (Linux/macOS)");
  }
  const name = options.name ?? `kunai-agent-${process.pid}-${Date.now().toString(36)}`;
  assertSessionName(name);
  const columns = options.columns ?? 100;
  const rows = options.rows ?? 30;

  const ownProfile = options.profile === undefined;
  const profile = options.profile ?? createIsolatedCliProfile(name);
  try {
    if ((options.seed ?? "onboarded") === "onboarded") {
      writeFileSync(profile.paths.configPath, `${JSON.stringify(onboardedConfig())}\n`);
    }

    const runScript = writeLaunchScript(profile, options);
    await tmux([
      "new-session",
      "-d",
      "-s",
      name,
      "-x",
      String(columns),
      "-y",
      String(rows),
      `sh ${JSON.stringify(runScript)}`,
    ]);
    // remain-on-exit keeps the final frame + pane_dead after the app exits —
    // that is how `isDead` and the post-quit screenshot both work.
    await tmux(["set-option", "-t", name, "remain-on-exit", "on"]);

    return attachTmuxSession({ name, profile, runScript, keepProfile: options.keepProfile });
  } catch (error) {
    // A start that never became a session must not leak the sandbox it made.
    if (ownProfile) disposeIsolatedCliProfile(profile);
    throw error;
  }
}

/** Write the env-owning launch script into the sandbox; returns its path. */
function writeLaunchScript(profile: IsolatedCliProfile, options: TmuxSessionOptions): string {
  // The launch script owns env so tmux gets one simple argv and quoting stays
  // out of the tmux layer entirely. `profile.env` is the storageRootEnv set —
  // HOME + XDG + APPDATA, the same isolation every other harness uses.
  const env: Record<string, string> = {
    ...profile.env,
    KUNAI_COMPILED_SMOKE: "1",
    KUNAI_COMPILED_SMOKE_FIXTURE: FIXTURE_PROVIDER,
    KUNAI_POSTER: "0",
    KUNAI_REDUCED_MOTION: "1",
    KUNAI_DISABLE_EXTERNAL_URL: "1",
    TERM: "xterm-256color",
    ...options.env,
  };

  const bunBin = Bun.which("bun") ?? "bun";
  const pathParts: string[] = options.pathPrefix ? [options.pathPrefix] : [];
  if (options.fakeMpv !== false) {
    const shimDir = join(profile.rootDir, "shim");
    mkdirSync(shimDir, { recursive: true });
    writeFileSync(
      join(shimDir, "mpv"),
      `#!/bin/sh\nexec ${JSON.stringify(bunBin)} ${JSON.stringify(FAKE_MPV_BIN)} "$@"\n`,
      { mode: 0o755 },
    );
    env.KUNAI_FAKE_MPV_EVIDENCE = join(profile.rootDir, "fake-mpv-evidence.jsonl");
    env.KUNAI_FAKE_MPV_MODE = options.fakeMpvMode ?? "normal";
    pathParts.push(shimDir);
  }

  // `--command` documents as extra args to main.ts, not a replacement —
  // appending keeps the real entrypoint while letting a run carry `-S`,
  // `--debug`, etc. The string lands verbatim in the launch script, so
  // shell quoting inside it is honored.
  const baseCommand = `${JSON.stringify(bunBin)} ${JSON.stringify(join(CLI_ROOT, "src/main.ts"))}`;
  const command = options.command ? `${baseCommand} ${options.command}` : baseCommand;
  const runScript = join(profile.rootDir, "run.sh");
  // PATH is computed, not exported like the rest — a caller-provided env.PATH
  // must merge INTO the computation (after the prefix dirs), or it would be
  // written then silently overwritten by the line below.
  const { PATH: callerPath, ...envRest } = env;
  const envLines = Object.entries(envRest)
    .map(([k, v]) => `export ${k}=${JSON.stringify(v)}`)
    .join("\n");
  const finalPath = [
    ...pathParts,
    ...(callerPath ? callerPath.split(":") : []),
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ].join(":");
  writeFileSync(
    runScript,
    `#!/bin/sh\n${envLines}\nexport PATH=${JSON.stringify(finalPath)}\ncd ${JSON.stringify(CLI_ROOT)}\nexec ${command}\n`,
    { mode: 0o755 },
  );
  return runScript;
}

/**
 * Reattach to an already-running tmux session — the `agent:session` CLI calls
 * this on every invocation after `start`, so `do`/`see`/`stop` work across
 * separate process runs. `profile` may be a paths-only stand-in when the
 * sandbox was created by an earlier invocation (inspector + keepProfile=false
 * still work; only `stop` needs the rootDir).
 */
export function attachTmuxSession(input: {
  readonly name: string;
  readonly profile: IsolatedCliProfile;
  readonly runScript: string;
  readonly keepProfile?: boolean;
}): TmuxSession {
  const { name, profile, runScript } = input;
  let stopped = false;

  const see = async (): Promise<string> => {
    const out = await tmux(["capture-pane", "-p", "-t", name]);
    return stripAnsi(out).replace(/\s+$/, "");
  };

  const isDead = async (): Promise<boolean> => {
    const out = await tmux(["display-message", "-p", "-t", name, "#{pane_dead}"]);
    return out.trim() === "1";
  };

  // What the pane's process is doing when a wait fails — an empty pane with a
  // live `bun` command means "running but silent", a dead pane or `sh` means
  // the launch script never exec'd the app. Without this a CI timeout is a
  // shrug; with it the failure names its own suspect.
  const paneStatus = async (): Promise<string> => {
    try {
      const out = await tmux([
        "display-message",
        "-p",
        "-t",
        name,
        "pid=#{pane_pid} dead=#{pane_dead} cmd=#{pane_current_command}",
      ]);
      return out.trim();
    } catch {
      return "(pane status unavailable)";
    }
  };

  const session: TmuxSession = {
    name,
    profile,
    target: name,
    async send(...keys) {
      // Consecutive literals coalesce into one send-keys -l call — typing a
      // query is one tmux invocation, not one per character.
      let literals: string[] = [];
      const flushLiterals = async () => {
        if (literals.length === 0) return;
        // -l sends the literal bytes — safe for text like "Enter" too.
        await tmux(["send-keys", "-t", name, "-l", literals.join("")]);
        literals = [];
      };
      for (const key of keys) {
        const named = TMUX_KEY_NAMES[key];
        if (named) {
          await flushLiterals();
          await tmux(["send-keys", "-t", name, named]);
        } else {
          literals.push(key);
        }
      }
      await flushLiterals();
    },
    see,
    seeRaw: async () => {
      const out = await tmux(["capture-pane", "-p", "-e", "-t", name]);
      return out.replace(/\s+$/, "");
    },
    async waitFor(pred, label, timeoutMs) {
      const deadline = Date.now() + (timeoutMs ?? SETTLE_TIMEOUT_MS);
      let last = "";
      while (Date.now() < deadline) {
        last = await see();
        if (pred(last)) return;
        if (await isDead()) {
          throw new Error(
            `waitFor(${label ?? "predicate"}) — the app exited while waiting.\n` +
              `Final pane:\n${last}`,
          );
        }
        await Bun.sleep(120);
      }
      throw new Error(
        `waitFor(${label ?? "predicate"}) timed out after ${timeoutMs ?? SETTLE_TIMEOUT_MS}ms ` +
          `(${await paneStatus()}).\n` +
          `Final pane:\n${last.length > 0 ? last : "(empty — the process produced no output)"}`,
      );
    },
    async waitSettled() {
      const deadline = Date.now() + SETTLE_TIMEOUT_MS;
      let last = await see();
      let stable = 0;
      while (Date.now() < deadline) {
        await Bun.sleep(120);
        const next = await see();
        stable = next === last ? stable + 1 : 0;
        if (stable >= SETTLE_POLLS) return;
        last = next;
      }
      throw new Error(`waitSettled timed out after ${SETTLE_TIMEOUT_MS}ms — pane kept changing`);
    },
    isDead,
    async quit() {
      await session.send("\x03");
      const deadline = Date.now() + DEATH_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (await isDead()) return;
        await Bun.sleep(120);
      }
      throw new Error(`app did not exit within ${DEATH_TIMEOUT_MS}ms of Ctrl+C`);
    },
    async relaunch() {
      await session.quit();
      await tmux(["respawn-pane", "-k", "-t", name, `sh ${JSON.stringify(runScript)}`]);
    },
    inspect: () => createProfileInspector(profile.paths),
    snapshot: () => createProfileInspector(profile.paths).snapshot(),
    diffSince: (before) => diffSnapshots(before, createProfileInspector(profile.paths).snapshot()),
    async stop() {
      if (stopped) return;
      stopped = true;
      try {
        await tmux(["kill-session", "-t", name]);
      } catch {
        // already dead — fine
      }
      if (!input.keepProfile) disposeIsolatedCliProfile(profile);
    },
  };
  return session;
}

/** Sidecar for the `agent:session` CLI — where the sandbox lives. The whole
 * profile serializes cleanly (it is plain data) so `attach` can rebuild the
 * inspector and the launch script path across process invocations. */
export interface SessionSidecar {
  readonly name: string;
  readonly profile: IsolatedCliProfile;
  readonly runScript: string;
  readonly startedAt: string;
  /** Start's `--keep-profile` decision — stop is a separate process, so the
   *  choice has to ride in the sidecar or it is silently dropped. */
  readonly keepProfile?: boolean;
}

/** Deterministic per-name state path so `start`/`do`/`stop` invocations agree. */
export function tmuxSessionStatePath(name: string): string {
  assertSessionName(name);
  return join(tmpdir(), `kunai-agent-${name}.json`);
}
