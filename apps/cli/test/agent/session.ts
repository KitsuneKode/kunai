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
 *   wait-for <text>     block until the pane contains text (bounded)
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

import type { IsolatedCliProfile } from "../integration/helpers/isolated-container";
import { K } from "./keys";
import { createProfileInspector } from "./profile-inspector";
import { attachTmuxSession, startTmuxSession, tmuxSessionStatePath } from "./tmux-session";

interface SessionSidecar {
  readonly name: string;
  readonly profile: IsolatedCliProfile;
  readonly runScript: string;
  readonly startedAt: string;
}

const NAMED_KEYS: Record<string, string> = {
  enter: K.enter,
  esc: K.esc,
  escape: K.esc,
  tab: K.tab,
  space: K.space,
  backspace: K.backspace,
  up: K.up,
  down: K.down,
  left: K.left,
  right: K.right,
  ctrlc: K.ctrlC,
};

function decodeKey(raw: string): string {
  const name = /^<([a-zA-Z]+)>$/.exec(raw)?.[1];
  if (name) {
    const key = NAMED_KEYS[name.toLowerCase()];
    if (!key) throw new Error(`unknown key name <${name}>`);
    return key;
  }
  return raw
    .replace(/\\x1b|\\e/g, "\x1b")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\n/g, "\n");
}

function usage(): never {
  console.error(`usage: bun run agent:session -- <command> [opts]
  start [--name N] [--seed onboarded|fresh] [--width C] [--rows R]
        [--no-fake-mpv] [--command "..."] [--keep-profile]
  see [--name N] [--raw]
  do <key>... [--name N]      keys: text types literally, <enter> <esc> <up> ...
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

function loadSidecar(name: string): SessionSidecar {
  const path = tmuxSessionStatePath(name);
  if (!existsSync(path)) {
    throw new Error(
      `no session "${name}" (missing ${path}). Start one: bun run agent:session -- start --name ${name}`,
    );
  }
  return JSON.parse(readFileSync(path, "utf8")) as SessionSidecar;
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
      const seed = argValue(rest, "--seed") === "fresh" ? "fresh" : "onboarded";
      const session = await startTmuxSession({
        name,
        seed,
        columns: Number(argValue(rest, "--width")) || undefined,
        rows: Number(argValue(rest, "--rows")) || undefined,
        fakeMpv: !rest.includes("--no-fake-mpv"),
        command: argValue(rest, "--command"),
        keepProfile: rest.includes("--keep-profile"),
      });
      const sidecar: SessionSidecar = {
        name,
        profile: session.profile,
        runScript: join(session.profile.rootDir, "run.sh"),
        startedAt: new Date().toISOString(),
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
      // Positional args only — "--name" and its value are consumed separately.
      const nameIdx = rest.indexOf("--name");
      const positional =
        nameIdx >= 0 ? [...rest.slice(0, nameIdx), ...rest.slice(nameIdx + 2)] : rest;
      const keys = positional.filter((a) => !a.startsWith("--")).map(decodeKey);
      if (keys.length === 0) usage();
      const session = attach(name);
      await session.send(...keys);
      await session.waitSettled();
      console.log(await session.see());
      break;
    }

    case "wait-for": {
      const needle = rest.find((a) => !a.startsWith("--") && a !== name);
      if (!needle) usage();
      const session = attach(name);
      await session.waitFor((f) => f.includes(needle), `pane contains ${JSON.stringify(needle)}`);
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
      const what = rest.find((a) => !a.startsWith("--") && a !== name) ?? "tables";
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
      const dir = rest.find((a) => !a.startsWith("--") && a !== name);
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
      const session = attach(name);
      await session.stop();
      rmSync(tmuxSessionStatePath(name), { force: true });
      if (!sidecar.profile.rootDir.includes("kunai-integration-")) {
        // Paranoia: never delete a dir that isn't one of our sandboxes.
        throw new Error(`refusing to delete unexpected profile dir: ${sidecar.profile.rootDir}`);
      }
      rmSync(sidecar.profile.rootDir, { force: true, recursive: true });
      console.log(`stopped "${name}" and removed sandbox`);
      break;
    }

    default:
      usage();
  }
}

await main();
