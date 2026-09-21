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
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { ONBOARDING_VERSION } from "@/app/bootstrap/startup-setup";

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
  /** Send keys; each entry is one tmux send-keys argument set. */
  send(...keys: string[]): Promise<void>;
  /** Current visible pane, ANSI-stripped. */
  see(): Promise<string>;
  /** Current visible pane with color escapes preserved. */
  seeRaw(): Promise<string>;
  waitFor(pred: (frame: string) => boolean, label?: string): Promise<void>;
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

function onboardedConfig(): Record<string, unknown> {
  return {
    onboardingVersion: ONBOARDING_VERSION,
    downloadOnboardingDismissed: true,
    provider: "videasy",
    animeProvider: "allanime",
    analytics: "disabled",
    installId: "",
  };
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
  const columns = options.columns ?? 100;
  const rows = options.rows ?? 30;

  const profile = options.profile ?? createIsolatedCliProfile(name);
  if ((options.seed ?? "onboarded") === "onboarded") {
    writeFileSync(profile.paths.configPath, `${JSON.stringify(onboardedConfig())}\n`);
  }

  const runScript = await writeLaunchScript(profile, name, options);
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
}

/** Write the env-owning launch script into the sandbox; returns its path. */
async function writeLaunchScript(
  profile: IsolatedCliProfile,
  _name: string,
  options: TmuxSessionOptions,
): Promise<string> {
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

  const pathParts: string[] = options.pathPrefix ? [options.pathPrefix] : [];
  if (options.fakeMpv !== false) {
    const shimDir = join(profile.rootDir, "shim");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(shimDir, { recursive: true });
    const bunBin = Bun.which("bun") ?? "bun";
    writeFileSync(
      join(shimDir, "mpv"),
      `#!/bin/sh\nexec ${JSON.stringify(bunBin)} ${JSON.stringify(FAKE_MPV_BIN)} "$@"\n`,
      { mode: 0o755 },
    );
    env.KUNAI_FAKE_MPV_EVIDENCE = join(profile.rootDir, "fake-mpv-evidence.jsonl");
    env.KUNAI_FAKE_MPV_MODE = options.fakeMpvMode ?? "normal";
    pathParts.push(shimDir);
  }

  const bunBin = Bun.which("bun") ?? "bun";
  const command =
    options.command ?? `${JSON.stringify(bunBin)} ${JSON.stringify(join(CLI_ROOT, "src/main.ts"))}`;
  const runScript = join(profile.rootDir, "run.sh");
  const envLines = Object.entries(env)
    .map(([k, v]) => `export ${k}=${JSON.stringify(v)}`)
    .join("\n");
  writeFileSync(
    runScript,
    `#!/bin/sh\n${envLines}\nexport PATH=${JSON.stringify([...pathParts, "/usr/local/bin", "/usr/bin", "/bin"].join(":"))}\ncd ${JSON.stringify(CLI_ROOT)}\nexec ${command}\n`,
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
  const ANSI_CSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, "g");

  const see = async (): Promise<string> => {
    const out = await tmux(["capture-pane", "-p", "-t", name]);
    return out.replace(ANSI_CSI, "").replace(/\s+$/, "");
  };

  const isDead = async (): Promise<boolean> => {
    const out = await tmux(["display-message", "-p", "-t", name, "#{pane_dead}"]);
    return out.trim() === "1";
  };

  const session: TmuxSession = {
    name,
    profile,
    target: name,
    async send(...keys) {
      for (const key of keys) {
        const named = TMUX_KEY_NAMES[key];
        if (named) {
          await tmux(["send-keys", "-t", name, named]);
        } else {
          // -l sends the literal bytes — safe for text like "Enter" too.
          await tmux(["send-keys", "-t", name, "-l", key]);
        }
      }
    },
    see,
    seeRaw: async () => {
      const out = await tmux(["capture-pane", "-p", "-e", "-t", name]);
      return out.replace(/\s+$/, "");
    },
    async waitFor(pred, label) {
      const deadline = Date.now() + SETTLE_TIMEOUT_MS;
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
        `waitFor(${label ?? "predicate"}) timed out after ${SETTLE_TIMEOUT_MS}ms.\n` +
          `Final pane:\n${last}`,
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

/** Sidecar for the `agent:session` CLI — where the sandbox lives. */
export interface TmuxSessionState {
  readonly name: string;
  readonly profileDir: string;
  readonly startedAt: string;
}

/** Deterministic per-name state path so `start`/`do`/`stop` invocations agree. */
export function tmuxSessionStatePath(name: string): string {
  return join(tmpdir(), `kunai-agent-${name}.json`);
}
