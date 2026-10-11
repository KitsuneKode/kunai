/**
 * `bun run agent:session` — the L3 agent driver. Holds a REAL `src/main.ts`
 * process inside a tmux session (real PTY, real keystrokes, real rendered
 * pane) on an isolated, seeded profile. Each invocation is a fresh process —
 * the held state is the tmux session itself plus a small sidecar file, so the
 * loop survives across agent turns and cleanup is `stop` (or `tmux kill-session`).
 *
 *   start    --name N --seed onboarded|fresh --width C --rows R --no-fake-mpv
 *            --command "--offline"        (extra main.ts arguments; default name: kunai-agent)
 *   see      print the current rendered pane (add --raw for ANSI colors)
 *   do       send keys: `do smoke "<enter>"` — same key vocabulary as agent:drive
 *   wait-for <text>     block until the pane contains text (bounded);
 *                       `/pattern/` waits on a regex match instead
 *   relaunch            quit via Ctrl+C, then respawn the same profile
 *   inspect  history|queue|config|tables — read the live SQLite/config
 *   report   <dir>      write an evidence bundle (pane + backend snapshot)
 *   stop                kill the tmux session and delete the sandbox
 *
 * Citations: `report` + grep is the mechanical check — quote lines that exist
 * in the bundle, never claim from memory.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { z } from "zod";

import { advertisedKeys, bootSurface, frameMatcher } from "./frame-match";
import { decodeKeyToken } from "./keys";
import { createProfileInspector } from "./profile-inspector";
import {
  attachTmuxSession,
  startTmuxSession,
  tmuxSessionStatePath,
  type SessionSidecar,
  type TmuxSession,
} from "./tmux-session";

function usage(): never {
  console.error(`usage: bun run agent:session -- <command> [opts]
  start [--name N] [--seed onboarded|fresh] [--width C] [--rows R]
        [--no-fake-mpv] [--command "..."] [--keep-profile] [--set-env K=V]...
  see [--name N] [--raw]
  doctor [--name N]          check liveness, interactive surface and profile isolation
  do <key>... [--name N]      keys: text types literally, <enter> <esc> <up> ...
  keys [--name N]             list the [key] hints the current pane advertises
  wait-for <text> [--name N]
  relaunch [--name N]
  inspect <history|queue|config|tables> [--name N]
  report <dir> [--name N]
  stop [--name N]`);
  process.exit(2);
}

function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

function sessionName(argv: string[]): string {
  return argValue(argv, "--name") ?? "kunai-agent";
}

/** Reject unrecognized `--flags` — a typo'd flag silently ignored has already
 * burned one debugging session (`--profile fresh` instead of `--seed fresh`).
 * Flag VALUES (the token after a known flag) are skipped; anything else
 * starting with `--` that isn't in `known` is a hard error. */
function rejectUnknownFlags(argv: string[], known: readonly string[]): void {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    if (!known.includes(arg)) {
      console.error(`unknown flag: ${arg}`);
      usage();
    }
    if (["--no-fake-mpv", "--keep-profile", "--raw"].includes(arg)) continue;
    const next = argv[i + 1];
    if (next === undefined) {
      console.error(`missing value for ${arg}`);
      usage();
    }
    // An app argument such as --offline belongs to --command, even though
    // it looks like a harness flag. Boolean switches consume no value.
    i += 1;
  }
}

/** Positional args with the `--name N` pair removed — `do`/`wait-for`/`inspect`
 * all take their payload positionally. */
function positionalArgs(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--name") {
      i += 1; // skip the flag's value too
      continue;
    }
    if (arg !== undefined && !arg.startsWith("--")) out.push(arg);
  }
  return out;
}

function loadSidecar(name: string): SessionSidecar {
  const path = tmuxSessionStatePath(name);
  if (!existsSync(path)) {
    throw new Error(
      `no session "${name}" (missing ${path}). Start one: bun run agent:session -- start --name ${name}`,
    );
  }
  const result = sessionSidecarSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!result.success) {
    throw new Error(`corrupt session sidecar ${path} — delete it and start a fresh session`);
  }
  const parsed = result.data;
  if (parsed.name !== name) throw new Error(`session sidecar name does not match ${name}`);
  assertIsolatedProfile(parsed);
  return parsed;
}

function within(root: string, path: string): boolean {
  // Resolve existing ancestors too: an absent DB below a symlink must not
  // bypass containment merely because the final file has not been created.
  let ancestor = resolve(path);
  const missing: string[] = [];
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) return false;
    missing.unshift(basename(ancestor));
    ancestor = parent;
  }
  const resolved = join(realpathSync(ancestor), ...missing);
  const rel = relative(root, resolved);
  return (
    rel !== ".." &&
    !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
    !isAbsolute(rel)
  );
}

/** Validate the inspector's paths before any database or config read. */
function assertIsolatedProfile(sidecar: SessionSidecar): void {
  const { profile } = sidecar;
  const root = realpathSync(profile.rootDir);
  const temporaryRoot = realpathSync(tmpdir());
  if (root === temporaryRoot || !within(temporaryRoot, root)) {
    throw new Error("session profile must be a private directory inside the temporary root");
  }
  for (const key of [
    "HOME",
    "USERPROFILE",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "APPDATA",
    "LOCALAPPDATA",
  ]) {
    const value = profile.env[key];
    if (!value || realpathSync(value) !== root)
      throw new Error(`session storage root ${key} is not isolated`);
  }
  if (profile.env.KUNAI_CREDENTIAL_BACKEND !== "file") {
    throw new Error("session credential backend must be file; native vaults are account-wide");
  }
  for (const path of [
    sidecar.runScript,
    profile.paths.configPath,
    profile.paths.dataDbPath,
    profile.paths.cacheDbPath,
  ]) {
    if (!within(root, path)) throw new Error("session inspector path escapes the shadow profile");
  }
}

/** Decode the entire persisted profile contract at the sidecar read boundary. */
const sessionSidecarSchema = z.object({
  name: z.string(),
  runScript: z.string(),
  startedAt: z.string(),
  keepProfile: z.boolean().optional(),
  profile: z.object({
    rootDir: z.string(),
    configHome: z.string(),
    dataHome: z.string(),
    cacheHome: z.string(),
    env: z.record(z.string(), z.string()),
    paths: z.object({
      configDir: z.string(),
      dataDir: z.string(),
      cacheDir: z.string(),
      tempDir: z.string(),
      configPath: z.string(),
      mpvBridgePath: z.string(),
      dataDbPath: z.string(),
      cacheDbPath: z.string(),
      logPath: z.string(),
    }),
  }),
}) satisfies z.ZodType<SessionSidecar>;

function attach(name: string) {
  const sidecar = loadSidecar(name);
  return attachTmuxSession({
    name,
    profile: sidecar.profile,
    runScript: sidecar.runScript,
    keepProfile: true, // stop owns deletion; attach never does
  });
}

async function writeReport(session: TmuxSession, dir: string): Promise<void> {
  const frame = await session.see();
  const inspect = session.inspect();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "frame.txt"), `${frame}\n`);
  writeFileSync(join(dir, "frame-raw.txt"), `${await session.seeRaw()}\n`);
  writeFileSync(
    join(dir, "backend.json"),
    `${JSON.stringify(
      {
        dead: await session.isDead(),
        config: inspect.config(),
        tables: inspect.tables(),
        history: inspect.history(),
        queue: inspect.queue(),
      },
      null,
      2,
    )}\n`,
  );
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command) usage();
  const name = sessionName(rest);

  switch (command) {
    case "start": {
      rejectUnknownFlags(rest, [
        "--name",
        "--seed",
        "--width",
        "--rows",
        "--no-fake-mpv",
        "--command",
        "--keep-profile",
        "--set-env",
      ]);
      const seedArg = argValue(rest, "--seed");
      if (seedArg !== undefined && seedArg !== "onboarded" && seedArg !== "fresh") usage();
      const seed = seedArg === "fresh" ? "fresh" : "onboarded";
      const env: Record<string, string> = {};
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] !== "--set-env") continue;
        const kv = rest[i + 1] ?? "";
        const eq = kv.indexOf("=");
        const key = kv.slice(0, eq);
        if (eq <= 0 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) usage();
        env[key] = kv.slice(eq + 1);
      }
      const width = Number(argValue(rest, "--width") ?? "");
      const rows = Number(argValue(rest, "--rows") ?? "");
      if (
        (argValue(rest, "--width") !== undefined && !(width > 0)) ||
        (argValue(rest, "--rows") !== undefined && !(rows > 0))
      ) {
        usage();
      }
      const session = await startTmuxSession({
        name,
        seed,
        columns: argValue(rest, "--width") !== undefined ? width : undefined,
        rows: argValue(rest, "--rows") !== undefined ? rows : undefined,
        fakeMpv: !rest.includes("--no-fake-mpv"),
        command: argValue(rest, "--command"),
        keepProfile: rest.includes("--keep-profile"),
        env,
      });
      const sidecar: SessionSidecar = {
        name,
        profile: session.profile,
        runScript: join(session.profile.rootDir, "run.sh"),
        startedAt: new Date().toISOString(),
        keepProfile: rest.includes("--keep-profile"),
      };
      writeFileSync(tmuxSessionStatePath(name), `${JSON.stringify(sidecar)}\n`);
      // Boot takes a beat — wait for the shell chrome before reporting ready.
      try {
        await session.waitFor((f) => bootSurface(f) !== null, "interactive startup surface");
      } catch (error) {
        // Evidence lives outside the profile stop() owns. Never leave a
        // failed boot attached as if it were a healthy held session.
        const evidence = mkdtempSync(join(tmpdir(), `kunai-start-failure-${name}-`));
        try {
          await writeReport(session, evidence);
        } catch (captureError) {
          writeFileSync(join(evidence, "capture-error.txt"), String(captureError));
        } finally {
          await session.stop();
          rmSync(tmuxSessionStatePath(name), { force: true });
        }
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}\nEvidence retained at ${evidence}`,
          { cause: error },
        );
      }
      console.log(`started tmux session "${name}" · profile ${session.profile.rootDir}`);
      console.log(`see it:  bun run agent:session -- see --name ${name}`);
      break;
    }

    case "doctor": {
      rejectUnknownFlags(rest, ["--name"]);
      const sidecar = loadSidecar(name);
      const session = attach(name);
      if (await session.isDead())
        throw new Error(`session ${name} exited; relaunch before driving it`);
      const surface = bootSurface(await session.see());
      if (!surface)
        throw new Error(
          `session ${name} has no ready interactive surface; capture evidence and relaunch`,
        );
      const config = session.inspect().config();
      if (
        config.analytics === "enabled" ||
        (config.installId !== undefined && config.installId !== "")
      ) {
        throw new Error(
          "session analytics privacy check failed; retain evidence and stop this run",
        );
      }
      console.log(`healthy ${name} · ${surface} · credential backend file`);
      console.log(`shadow profile: ${sidecar.profile.rootDir}`);
      console.log(`launch script: ${sidecar.runScript}`);
      break;
    }

    case "see": {
      rejectUnknownFlags(rest, ["--name", "--raw"]);
      const session = attach(name);
      console.log(rest.includes("--raw") ? await session.seeRaw() : await session.see());
      break;
    }

    case "do": {
      rejectUnknownFlags(rest, ["--name"]);
      const keys = positionalArgs(rest).map(decodeKeyToken);
      if (keys.length === 0) usage();
      const session = attach(name);
      await session.send(...keys);
      await session.waitSettled();
      console.log(await session.see());
      break;
    }

    case "keys": {
      rejectUnknownFlags(rest, ["--name"]);
      const session = attach(name);
      const keys = advertisedKeys(await session.see());
      console.log(keys.length > 0 ? keys.join("\n") : "(no advertised keys in pane)");
      break;
    }

    case "wait-for": {
      rejectUnknownFlags(rest, ["--name"]);
      const needle = positionalArgs(rest)[0];
      if (!needle) usage();
      const session = attach(name);
      await session.waitFor(frameMatcher(needle), `pane matches ${JSON.stringify(needle)}`);
      console.log(await session.see());
      break;
    }

    case "relaunch": {
      rejectUnknownFlags(rest, ["--name"]);
      const session = attach(name);
      await session.relaunch();
      await session.waitFor((f) => bootSurface(f) !== null, "interactive relaunch surface");
      console.log(await session.see());
      break;
    }

    case "inspect": {
      rejectUnknownFlags(rest, ["--name"]);
      const sidecar = loadSidecar(name);
      const what = positionalArgs(rest)[0] ?? "tables";
      if (!["history", "queue", "config", "tables"].includes(what)) {
        throw new Error(
          `unknown inspect target ${JSON.stringify(what)} — history|queue|config|tables`,
        );
      }
      const inspect = createProfileInspector(sidecar.profile.paths);
      const section =
        what === "history"
          ? inspect.history()
          : what === "queue"
            ? inspect.queue()
            : what === "config"
              ? inspect.config()
              : inspect.tables();
      console.log(JSON.stringify(section, null, 2));
      break;
    }

    case "report": {
      rejectUnknownFlags(rest, ["--name"]);
      const dir = positionalArgs(rest)[0];
      if (!dir) usage();
      const session = attach(name);
      await writeReport(session, dir);
      console.log(`evidence: ${dir}/frame.txt ${dir}/backend.json`);
      break;
    }

    case "stop": {
      rejectUnknownFlags(rest, ["--name"]);
      const sidecar = loadSidecar(name);
      const root = realpathSync(sidecar.profile.rootDir);
      if (
        !sidecar.keepProfile &&
        (dirname(root) !== realpathSync(tmpdir()) ||
          !basename(root).startsWith(`kunai-integration-${name}-`))
      ) {
        // Paranoia FIRST: a refusal must not leave a half-cleaned state —
        // check before killing the session or touching the sidecar.
        throw new Error(`refusing to delete unexpected profile dir: ${sidecar.profile.rootDir}`);
      }
      const session = attach(name);
      await session.stop();
      if (sidecar.keepProfile) {
        console.log(`stopped "${name}" — profile kept at ${sidecar.profile.rootDir}`);
      } else {
        rmSync(sidecar.profile.rootDir, { force: true, recursive: true });
        console.log(`stopped "${name}" and removed sandbox`);
      }
      rmSync(tmuxSessionStatePath(name), { force: true });
      break;
    }

    default:
      usage();
  }
}

// A failed wait or bad flag is a user-facing error, not a programming fault —
// print the message, not a raw stack.
main().catch((error: unknown) => {
  console.error(`[agent] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
