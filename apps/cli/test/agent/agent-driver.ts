/**
 * L2 agent driver — mounts the REAL root shell (`AppRoot`) plus the REAL
 * session loop (`SessionController.run`) against a REAL container on a
 * throwaway, seeded profile, then lets a test (or `agent:drive`) type
 * keystrokes and assert both the rendered frame and the SQLite backend in one
 * run. This is the harness that unblocks plan 010: the failure class it
 * catches is the silent no-op — a flag parsed and dropped, a setting persisted
 * and ignored — which no unit test can see because each half works alone.
 *
 * Why the controller matters: `AppRoot` alone renders only the idle welcome —
 * `SearchPhase` is what mounts `BrowseShell` into the root via
 * `mountRootContent`. Running `controller.run({})` puts the actual phase
 * machine in the loop, so every surface is reached the way a user reaches it:
 * by typing.
 *
 * What it deliberately is NOT: the shipped binary. `main.ts` owns argv parsing,
 * the setup gate, stdinManager/alt-screen, signal handling, and the shutdown
 * coordinator. The driver binds the shutdown-request bridge itself (without
 * one, a Ctrl+C in the shell would `process.kill` the test runner — see
 * shutdown-request.ts:36). L2 asks "is it wired?"; L3 (tmux-session.ts) asks
 * "does it work for a user?".
 *
 * Isolation contract (enforced, not conventional):
 *  - exactly one live session per process — a second createAgentSession throws;
 *  - env mutations are undone in LIFO order on dispose (storage root, KUNAI_*,
 *    PATH) — never `KUNAI_CONFIG_DIR`, never the developer's real profile;
 *  - dispose order is fixed: settle session loop → unmount Ink → clear
 *    root-content globals → close DBs → undo env → delete profile.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { forceSettleAllRootContent } from "@/app-shell/root-content-state";
import type { SessionController } from "@/app/session/SessionController";
import type { ShutdownIntent } from "@/app/session/shutdown-coordinator";
import { bindShutdownRequestHandler } from "@/app/session/shutdown-request";
import type { Container } from "@/container";
import { createElement } from "react";

import { render, stripAnsi, type RenderHandle } from "../harness/render-capture";
import { applyStorageRootEnv } from "../helpers/storage-env";
import {
  createIsolatedCliProfile,
  disposeIsolatedCliProfile,
  type IsolatedCliProfile,
} from "../integration/helpers/isolated-container";
import { waitUntil } from "../support/wait-until";
import { K, keyLabel } from "./keys";
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

export type AgentSessionSeed = "onboarded" | "fresh" | Record<string, unknown>;

export interface AgentSessionOptions {
  /** Temp-dir label; also prefixes the evidence dir name. */
  readonly label?: string;
  readonly columns?: number;
  readonly rows?: number;
  /**
   * `"onboarded"` (default) writes a completed-setup config with analytics
   * explicitly declined — the state a returning user is in. `"fresh"` writes
   * nothing: on a TTY that lands in the setup wizard (a real user path, and
   * one explicit scenario). A record is written verbatim as config.json.
   */
  readonly seed?: AgentSessionSeed;
  /** `"smoke"` (default) loads fixture providers through the real env gate. */
  readonly providers?: "smoke" | "none";
  /** `"fake"` PATH-shims the fake mpv so playback flows can run in-process. */
  readonly mpv?: "fake" | "none";
  readonly fakeMpvMode?: "normal" | "fail-pre-loaded" | "hold";
  /** Record a step journal (frame + DB delta per event) for evidence bundles. */
  readonly recordEvidence?: boolean;
  readonly extraEnv?: Record<string, string>;
}

export interface JournalEntry {
  readonly step: number;
  readonly kind: "boot" | "press" | "wait" | "note" | "quit" | "relaunch";
  readonly label: string;
  readonly frame: string;
  /** DB delta introduced by this step vs the previous journal entry. */
  readonly dbDelta: Record<string, { added: number; removed: number }>;
}

export interface AgentSession {
  readonly profile: IsolatedCliProfile;
  readonly journal: readonly JournalEntry[];
  /** Enqueue keystrokes; each argument is one input chunk (see keys.ts). */
  press(...keys: string[]): void;
  /** Resolve when `pred` holds on the current frame; throws after a budget. */
  waitForFrame(pred: (frame: string) => boolean, label?: string): Promise<void>;
  /** Resolve when the frame is unchanged across consecutive polls. */
  waitSettled(): Promise<void>;
  frame(): string;
  frames(): readonly string[];
  inspect(): ProfileInspector;
  /**
   * Bounded poll on BACKEND state (config.json, SQLite) — the deferred-writer
   * counterpart to waitForFrame. config.save() debounces ~300ms and progress
   * writes land on their own schedule; a point read right after a frame settles
   * races them. Poll the committed state instead of sleeping fixed durations.
   */
  waitForBackend(pred: (inspect: ProfileInspector) => boolean, label?: string): Promise<void>;
  /** Full-table snapshot for the DB-diff oracle. */
  snapshot(): ProfileSnapshot;
  diffSince(before: ProfileSnapshot): ProfileDelta;
  note(text: string): void;
  /**
   * Drive the shell's own quit path (what Ctrl+C / `/quit` trigger through the
   * shutdown-request bridge), let the session loop finish, then boot a fresh
   * session loop on the SAME profile — the in-process form of "close it and
   * open it again". L3's `relaunch` is the real-process version.
   */
  relaunch(): Promise<void>;
  /** True after the session loop exited (quit path taken or relaunch pending). */
  quitRequested(): ShutdownIntent | null;
  /** Analytics contract self-check: no installId, analytics not enabled. */
  assertPrivacyClean(): void;
  dispose(): Promise<void>;
}

// ---------------------------------------------------------------------------
// One live session per process — enforced, not conventional.
// ---------------------------------------------------------------------------

let activeSession: { label: string } | null = null;

/** Restore-on-dispose for arbitrary env keys, mirroring applyStorageRootEnv. */
function applyEnv(vars: Record<string, string>): () => void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

const SETTLE_POLLS = 3;
const SETTLE_TIMEOUT_MS = 10_000;
const SESSION_STOP_TIMEOUT_MS = 10_000;

/**
 * The session loop is the app's own async orchestrator: SearchPhase dispatches
 * state updates from promises, not from inside `act()`. React 19 logs
 * "An update to X inside a test was not wrapped in act(...)" for every one —
 * advisory only: Ink still commits the frame synchronously, so capture is
 * correct; the warning exists to force test hygiene, which the driver already
 * provides through waitForFrame/waitSettled predicates. Swallow ONLY this exact
 * warning for the session's lifetime so `agent:drive` output stays readable —
 * every other console.error passes through untouched.
 */
// React logs the printf-format string: args[0] contains "%s", not the name.
const ACT_WARNING_RE = /^An update to %s inside a test was not wrapped in act/;
function installActWarningFilter(): () => void {
  const original = console.error;
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === "string" && ACT_WARNING_RE.test(args[0])) return;
    original.apply(console, args);
  };
  return () => {
    console.error = original;
  };
}

// Polling uses a plain sleep, NOT an act()-wrapped one: updates arrive from
// the app's own async orchestrator (they commit to CaptureStdout regardless of
// act), and an async act() scope held open across a sleep serializes the
// React act queue against a continuously-running session loop.
async function pollSleep(ms: number): Promise<void> {
  await Bun.sleep(ms);
}

export async function createAgentSession(options: AgentSessionOptions): Promise<AgentSession> {
  if (activeSession) {
    throw new Error(
      `createAgentSession: a session ("${activeSession.label}") is already live. ` +
        `One session per process — process env and root-content globals are shared.`,
    );
  }
  const sessionLabel = options.label ?? "agent-session";
  activeSession = { label: sessionLabel };

  const cleanups: Array<() => void> = [];
  cleanups.push(installActWarningFilter());
  let unbindShutdown: (() => void) | null = null;
  let handle: RenderHandle | null = null;
  let container: Container | null = null;
  let profile: IsolatedCliProfile | null = null;
  const journal: JournalEntry[] = [];
  let lastSnapshot: ProfileSnapshot | null = null;
  let disposed = false;

  const record = options.recordEvidence ?? false;

  const takeSnapshot = (): ProfileSnapshot => {
    if (!profile) return new Map();
    return createProfileInspector(profile.paths).snapshot();
  };

  const deltaSummary = (delta: ProfileDelta): JournalEntry["dbDelta"] => {
    const out: JournalEntry["dbDelta"] = {};
    for (const [table, d] of delta) {
      out[table] = { added: d.added.length, removed: d.removed.length };
    }
    return out;
  };

  const pushJournal = (kind: JournalEntry["kind"], label: string, frame: string): void => {
    if (!record) return;
    const snap = takeSnapshot();
    const delta = lastSnapshot ? diffSnapshots(lastSnapshot, snap) : new Map();
    lastSnapshot = snap;
    journal.push({ step: journal.length, kind, label, frame, dbDelta: deltaSummary(delta) });
  };

  const runCleanups = () => {
    while (cleanups.length > 0) cleanups.pop()?.();
  };

  const columns = options.columns ?? 100;
  const rows = options.rows ?? 30;

  const closeContainerDbs = () => {
    if (!container) return;
    for (const db of [container.dataDb, container.cacheDb]) {
      try {
        db.close();
      } catch {
        // Already closed — disposal must not mask a real assertion failure.
      }
    }
  };

  try {
    profile = createIsolatedCliProfile(sessionLabel);
    cleanups.push(applyStorageRootEnv(profile.rootDir));

    // Deterministic-shell env. Seeded BEFORE the container import so the
    // first config read already sees the onboarded state.
    const seed = options.seed ?? "onboarded";
    if (seed !== "fresh") {
      const config = seed === "onboarded" ? onboardedConfig() : seed;
      writeFileSync(profile.paths.configPath, `${JSON.stringify(config)}\n`);
    }

    const env: Record<string, string> = {
      KUNAI_POSTER: "0",
      KUNAI_REDUCED_MOTION: "1",
      KUNAI_DISABLE_EXTERNAL_URL: "1",
      NO_COLOR: "1",
      ...options.extraEnv,
    };

    let providerModulesOverride;
    let searchServiceDefinitions;
    if ((options.providers ?? "smoke") === "smoke") {
      env.KUNAI_COMPILED_SMOKE = "1";
      env.KUNAI_COMPILED_SMOKE_FIXTURE = FIXTURE_PROVIDER;
    }

    if (options.mpv === "fake") {
      const shimDir = join(profile.rootDir, "shim");
      mkdirSync(shimDir, { recursive: true });
      const bunBin = Bun.which("bun") ?? "bun";
      writeFileSync(
        join(shimDir, "mpv"),
        `#!/bin/sh\nexec ${JSON.stringify(bunBin)} ${JSON.stringify(FAKE_MPV_BIN)} "$@"\n`,
        { mode: 0o755 },
      );
      // extraEnv.PATH merges AFTER the shim dir — a plain env.PATH assignment
      // would silently drop it.
      env.PATH = `${shimDir}:${options.extraEnv?.PATH ?? process.env.PATH ?? "/usr/bin:/bin"}`;
      env.KUNAI_FAKE_MPV_EVIDENCE = join(profile.rootDir, "fake-mpv-evidence.jsonl");
      env.KUNAI_FAKE_MPV_MODE = options.fakeMpvMode ?? "normal";
    }
    cleanups.push(applyEnv(env));

    const { createContainer } = await import("@/container");
    if (env.KUNAI_COMPILED_SMOKE === "1") {
      const { loadCompiledSmokeProviderOverride, loadCompiledSmokeSearchDefinitions } =
        await import("@/container/compiled-smoke-provider-override");
      [providerModulesOverride, searchServiceDefinitions] = await Promise.all([
        loadCompiledSmokeProviderOverride(),
        loadCompiledSmokeSearchDefinitions(),
      ]);
    }
    container = await createContainer({ providerModulesOverride, searchServiceDefinitions });

    const { AppRoot } = await import("@/app-shell/ink-shell");
    handle = render(createElement(AppRoot, { container }), { columns, rows });
  } catch (error) {
    try {
      handle?.unmount();
    } catch {
      // best effort
    }
    forceSettleAllRootContent("agent-session-boot-failed");
    closeContainerDbs();
    runCleanups();
    activeSession = null;
    if (profile) disposeIsolatedCliProfile(profile);
    throw error;
  }

  // Boot succeeded — these are non-null for the life of the session. `handle`
  // stays mutable because relaunch() re-mounts; everything else is const.
  if (!handle || !container || !profile) {
    throw new Error("unreachable: boot finished without handle/container/profile");
  }
  const sessionProfile = profile;
  const sessionContainer = container;
  const requireHandle = (): RenderHandle => {
    if (!handle) throw new Error("session is not mounted (disposed?)");
    return handle;
  };

  const frame = (): string => stripAnsi(requireHandle().lastFrame()).replace(/\s+$/, "");

  // --- Real session loop ----------------------------------------------------
  // The phase machine (Search → Playback → repeat) drives mountRootContent the
  // same way main.ts's SessionController.run does. Without it, AppRoot only
  // ever shows the idle welcome.
  const { SessionController } = await import("@/app/session/SessionController");
  let controller: SessionController = new SessionController(container);
  let runPromise: Promise<void> | null = null;
  let quitIntent: ShutdownIntent | null = null;
  let controllerGeneration = 0;

  let loopError: Error | null = null;
  const throwIfLoopFailed = () => {
    if (loopError) throw loopError;
  };

  const startLoop = () => {
    runPromise = controller.run({}).catch((error) => {
      // A failed loop is a finding, not a crash — surface it on the next wait.
      loopError = error instanceof Error ? error : new Error(String(error));
    });
  };

  // The shell's quit paths (Ctrl+C, /quit) request shutdown through this
  // bridge. Unbound, requestAppShutdown would SIGINT this test process — so
  // binding is not optional. The intent drives the real quiescence path.
  unbindShutdown = bindShutdownRequestHandler((intent) => {
    quitIntent = intent;
    controller.beginShutdown();
  });
  startLoop();

  const stopLoop = async () => {
    if (!runPromise) return;
    // Take the REAL quit path first — what a user does: Esc closes any open
    // overlay (settings/pickers hold the browse mount pending underneath —
    // verified: Esc-then-dispose unwinds in ~10ms), then Ctrl+C reaches the
    // shell's own handler → requestAppShutdown → our bound handler →
    // beginShutdown. forceSettle alone cannot unwind an overlay-blocked mount.
    for (const key of [K.esc, K.esc, K.ctrlC]) {
      try {
        handle?.stdin.enqueue(key);
      } catch {
        // stdin already torn down — fall through to the settle loop
      }
      await Bun.sleep(60);
    }
    controller.beginShutdown();
    // Phases mount NEW root content while unwinding (killing mpv resolves the
    // player promise, which mounts post-play, which blocks on input nobody
    // sends) — keep settling mounts until run() actually returns, bounded.
    const deadline = Date.now() + SESSION_STOP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      forceSettleAllRootContent("agent-session-stop");
      const done = await Promise.race([
        runPromise.then(
          () => true,
          () => true, // a failed loop still counts as stopped
        ),
        Bun.sleep(25).then(() => false),
      ]);
      if (done) return;
    }
    throw new Error(`session loop did not stop within ${SESSION_STOP_TIMEOUT_MS}ms`);
  };

  const session: AgentSession = {
    profile: sessionProfile,
    journal,
    press(...keys) {
      throwIfLoopFailed();
      for (const key of keys) {
        requireHandle().stdin.enqueue(key);
      }
      pushJournal("press", keys.map(keyLabel).join(" "), frame());
    },
    async waitForFrame(pred, label) {
      await waitUntil(
        () => {
          throwIfLoopFailed();
          return pred(frame());
        },
        {
          label: label ?? "waitForFrame",
          timeoutMs: SETTLE_TIMEOUT_MS,
          tick: pollSleep,
        },
      );
      pushJournal("wait", label ?? "waitForFrame", frame());
    },
    async waitSettled() {
      let last = frame();
      let stable = 0;
      await waitUntil(
        () => {
          throwIfLoopFailed();
          return stable >= SETTLE_POLLS;
        },
        {
          label: "waitSettled",
          timeoutMs: SETTLE_TIMEOUT_MS,
          tick: async (ms) => {
            await pollSleep(ms);
            const next = frame();
            stable = next === last ? stable + 1 : 0;
            last = next;
          },
        },
      );
      pushJournal("wait", "waitSettled", frame());
    },
    frame,
    frames: () => requireHandle().frames,
    inspect: () => createProfileInspector(sessionProfile.paths),
    async waitForBackend(pred, label) {
      await waitUntil(() => pred(createProfileInspector(sessionProfile.paths)), {
        label: label ?? "waitForBackend",
        timeoutMs: SETTLE_TIMEOUT_MS,
        tick: pollSleep,
      });
    },
    snapshot: takeSnapshot,
    diffSince: (before) => diffSnapshots(before, takeSnapshot()),
    note(text) {
      pushJournal("note", text, frame());
    },
    quitRequested: () => quitIntent,
    async relaunch() {
      // stopLoop sends the real Ctrl+C — only after it returns is quitIntent
      // populated, so the journal records the actual reason, not a guess.
      await stopLoop();
      pushJournal("quit", `quit (${quitIntent?.reason ?? "driver"})`, frame());
      const generation = ++controllerGeneration;
      requireHandle().unmount();
      forceSettleAllRootContent("agent-session-relaunch");
      quitIntent = null;
      controller = new SessionController(sessionContainer);
      const { AppRoot } = await import("@/app-shell/ink-shell");
      handle = render(createElement(AppRoot, { container: sessionContainer }), { columns, rows });
      if (generation !== controllerGeneration) return; // disposed mid-relaunch
      startLoop();
      pushJournal("relaunch", "relaunch", frame());
    },
    assertPrivacyClean() {
      const config = session.inspect().config();
      const installId = typeof config.installId === "string" ? config.installId.trim() : "";
      if (installId.length > 0) {
        throw new Error(
          `privacy invariant: installId was minted during the session (${installId}). ` +
            `Hazard 3: only an explicit keystroke may enable analytics.`,
        );
      }
      if (config.analytics === "enabled") {
        throw new Error("privacy invariant: analytics ended the session enabled");
      }
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      try {
        await stopLoop();
      } finally {
        try {
          handle?.unmount();
        } finally {
          // Module-level shell globals must be cleared before the next session —
          // synchronously, or a following createAgentSession can inherit the
          // previous session's content mount or leak a blocked mount promise.
          forceSettleAllRootContent("agent-session-dispose");
          closeContainerDbs();
          unbindShutdown?.();
          runCleanups();
          disposeIsolatedCliProfile(sessionProfile);
          activeSession = null;
        }
      }
    },
  };
  return session;
}
