/**
 * `bun run agent:session` — the L3 agent driver. Holds a REAL `src/main.ts`
 * process inside a tmux session (real PTY, real keystrokes, real rendered
 * pane) on an isolated, seeded profile. Each invocation is a fresh process —
 * the held state is the tmux session itself plus a small sidecar file, so the
 * loop survives across agent turns and cleanup is `stop` (or `tmux kill-session`).
 *
 *   start    --name N --seed onboarded|fresh --width C --rows R --no-fake-mpv
 *            --command "bun src/main.ts"    (default session name: kunai-agent)
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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { advertisedKeys, frameMatcher } from "./frame-match";
import { decodeKeyToken } from "./keys";
import { createProfileInspector } from "./profile-inspector";
import {
  attachTmuxSession,
  startTmuxSession,
  tmuxSessionStatePath,
  type SessionSidecar,
} from "./tmux-session";

function usage(): never {
  console.error(`usage: bun run agent:session -- <command> [opts]
  start [--name N] [--seed onboarded|fresh] [--width C] [--rows R]
        [--no-fake-mpv] [--command "..."] [--keep-profile] [--set-env K=V]...
  see [--name N] [--raw]
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
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      i += 1; // skip the flag's value
    }
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
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isSessionSidecar(parsed)) {
    throw new Error(`corrupt session sidecar ${path} — delete it and start a fresh session`);
  }
  return parsed;
}

/** Real shape guard — `in`-narrowing, no assertions. */
function isSessionSidecar(v: unknown): v is SessionSidecar {
  if (typeof v !== "object" || v === null) return false;
  if (!("profile" in v) || !("runScript" in v)) return false;
  const { profile, runScript } = v;
  return (
    typeof runScript === "string" &&
    typeof profile === "object" &&
    profile !== null &&
    "rootDir" in profile &&
    typeof profile.rootDir === "string"
  );
}

function attach(name: string) {
  const sidecar = loadSidecar(name);
  return attachTmuxSession({
    name,
    profile: sidecar.profile,
    runScript: sidecar.runScript,
    keepProfile: true, // stop owns deletion; attach never does
  });
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
      const seed = argValue(rest, "--seed") === "fresh" ? "fresh" : "onboarded";
      const env: Record<string, string> = {};
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] !== "--set-env") continue;
        const kv = rest[i + 1] ?? "";
        const eq = kv.indexOf("=");
        if (eq <= 0) usage();
        env[kv.slice(0, eq)] = kv.slice(eq + 1);
      }
      const session = await startTmuxSession({
        name,
        seed,
        columns: Number(argValue(rest, "--width")) || undefined,
        rows: Number(argValue(rest, "--rows")) || undefined,
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
      await session.waitFor((f) => f.includes("Kunai"), "shell boot");
      console.log(`started tmux session "${name}" · profile ${session.profile.rootDir}`);
      console.log(`see it:  bun run agent:session -- see --name ${name}`);
      break;
    }

    case "see": {
      const session = attach(name);
      console.log(rest.includes("--raw") ? await session.seeRaw() : await session.see());
      break;
    }

    case "do": {
      const keys = positionalArgs(rest).map(decodeKeyToken);
      if (keys.length === 0) usage();
      const session = attach(name);
      await session.send(...keys);
      await session.waitSettled();
      console.log(await session.see());
      break;
    }

    case "keys": {
      const session = attach(name);
      const keys = advertisedKeys(await session.see());
      console.log(keys.length > 0 ? keys.join("\n") : "(no advertised keys in pane)");
      break;
    }

    case "wait-for": {
      const needle = positionalArgs(rest)[0];
      if (!needle) usage();
      const session = attach(name);
      await session.waitFor(frameMatcher(needle), `pane matches ${JSON.stringify(needle)}`);
      console.log(await session.see());
      break;
    }

    case "relaunch": {
      const session = attach(name);
      await session.relaunch();
      await session.waitFor((f) => f.includes("Kunai"), "relaunch boot");
      console.log(await session.see());
      break;
    }

    case "inspect": {
      const sidecar = loadSidecar(name);
      const what = positionalArgs(rest)[0] ?? "tables";
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
      const dir = positionalArgs(rest)[0];
      if (!dir) usage();
      const session = attach(name);
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
      console.log(`evidence: ${dir}/frame.txt ${dir}/backend.json`);
      break;
    }

    case "stop": {
      const sidecar = loadSidecar(name);
      if (!sidecar.profile.rootDir.includes("kunai-integration-")) {
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
