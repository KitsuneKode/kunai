import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { getKunaiPaths, type StoragePlatform } from "@kunai/storage";

import { stripAnsi } from "../harness/render-capture";
import { describePosixOnly as describe } from "../helpers/platform-gates";
import { buildPtyCommand } from "../helpers/pty-command";
import { storageRootEnv } from "../helpers/storage-env";
import { removeTempDir } from "../support/remove-temp-dir";
import { onboardedConfig } from "./seed";

// The companion's picture tier, proved on the wire.
//
// A frame capture cannot see a graphics escape: tmux drops APC sequences and
// the in-process driver has no TTY, so she resolves to `off` there. These runs
// put the real `main.ts` under a real PTY, tell it the terminal is kitty, and
// read back every byte it wrote — which is what a terminal would have been
// handed. Fixture providers, a throwaway profile, no network.
//
// What the bytes can and cannot say: they say which commands were sent, in
// what order, and for how many frames. They do not say what a terminal drew.
// That is the eyes-on check in `test/harness/kanna-gallery.tsx`.

const ESC = "\x1b";
const PLACEHOLDER = "\u{10EEEE}";
const cliRoot = resolve(import.meta.dir, "../..");
const fixtureProvider = join(cliRoot, "src/app/compiled-smoke/fixture-provider.ts");
const fakeMpv = join(cliRoot, "test/integration/helpers/fake-mpv-bin.ts");
const bootTimeoutMs = 45_000;
const testTimeoutMs = bootTimeoutMs + 25_000;

const tempRoots: string[] = [];
const spawnedPids: number[] = [];

afterEach(() => {
  for (const pid of spawnedPids.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already exited
    }
  }
  for (const dir of tempRoots.splice(0)) removeTempDir(dir);
});

function hostStoragePlatform(): StoragePlatform {
  return process.platform === "darwin" ? "darwin" : "linux";
}

type Session = {
  /** Everything written to the terminal so far, escapes included. */
  readonly read: () => string;
  /** Wait until the transcript satisfies `ready`, or fail with what was written. */
  readonly waitFor: (ready: (bytes: string) => boolean, what: string) => Promise<string>;
  /** Deliver a signal and wait for the process to exit. */
  readonly stop: (signal: "SIGINT" | "SIGTERM") => Promise<number>;
  /** A path the fixture resolve waits on; create it to let the resolve finish. */
  readonly gate: string;
  /** Type into the terminal. Only where the PTY wrapper forwards stdin (Linux). */
  readonly type: (keys: string) => void;
};

/**
 * Boot the real CLI under a PTY as if inside kitty.
 *
 * `KITTY_WINDOW_ID` is what names the terminal; nothing answers the startup
 * probe or the cell-size query here, so she is sized from the 10x20 estimate.
 */
async function launch(options: {
  readonly args: string;
  readonly env?: Record<string, string>;
  /** Keep stdin open so the run can be typed into. */
  readonly interactive?: boolean;
}): Promise<Session> {
  const root = mkdtempSync(join(tmpdir(), "kunai-kanna-"));
  tempRoots.push(root);
  const storage = storageRootEnv(root);
  const paths = getKunaiPaths({ platform: hostStoragePlatform(), homeDir: root, env: storage });
  mkdirSync(paths.configDir, { recursive: true });
  writeFileSync(paths.configPath, `${JSON.stringify(onboardedConfig())}\n`);

  // A resolve that is let go reaches the player. The shim keeps that from being
  // the developer's real mpv, opened on a fixture URL.
  const shimDir = join(root, "shim");
  mkdirSync(shimDir, { recursive: true });
  writeFileSync(
    join(shimDir, "mpv"),
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeMpv)} "$@"\n`,
    { mode: 0o755 },
  );

  const gate = join(root, "resolve.gate");
  const env = {
    ...storage,
    KUNAI_COMPILED_SMOKE: "1",
    KUNAI_COMPILED_SMOKE_FIXTURE: fixtureProvider,
    KUNAI_SMOKE_RESOLVE_HOLD: gate,
    KUNAI_DISABLE_EXTERNAL_URL: "1",
    KUNAI_FAKE_MPV_MODE: "hold",
    PATH: `${shimDir}:${process.env.PATH ?? ""}`,
    KITTY_WINDOW_ID: "1",
    TERM: "xterm-kitty",
    ...options.env,
  };
  const assignments = Object.entries(env)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(" ");
  const pidFile = join(root, "cli.pid");
  const transcript = join(root, "cli.log");
  // The inherited environment is dropped for the names that would change the
  // answer: a developer running this inside tmux, or with the companion
  // already switched off, must get the same bytes CI does.
  const command = [
    `echo $$ > ${JSON.stringify(pidFile)};`,
    // A PTY starts at 80x24, and at that height she gives the picture up so
    // the surface keeps its own rows. These runs are about the picture.
    "stty rows 40 cols 110;",
    "exec env -u TMUX -u STY -u ZELLIJ -u NO_COLOR -u CI -u KUNAI_PET -u KUNAI_PLAIN",
    "-u KUNAI_POSTER -u KUNAI_REDUCED_MOTION -u NO_MOTION -u KUNAI_IMAGE_PROTOCOL",
    "-u SSH_CONNECTION -u SSH_TTY -u TERM_PROGRAM",
    assignments,
    `bun src/main.ts ${options.args}`,
  ].join(" ");
  const child = Bun.spawn(buildPtyCommand(command, transcript), {
    cwd: cliRoot,
    stdin: options.interactive ? "pipe" : "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  spawnedPids.push(child.pid);
  const type = (keys: string): void => {
    const stdin = child.stdin;
    if (!stdin) throw new Error("this session was not launched interactive");
    stdin.write(keys);
    stdin.flush();
  };

  const read = (): string => (existsSync(transcript) ? readFileSync(transcript, "utf8") : "");
  const waitFor = async (ready: (bytes: string) => boolean, what: string): Promise<string> => {
    const deadline = Date.now() + bootTimeoutMs;
    while (Date.now() < deadline) {
      const bytes = read();
      if (ready(bytes)) return bytes;
      // sleep-allow: polls a real CLI child's transcript for a rendered state
      await Bun.sleep(50);
    }
    throw new Error(`timed out waiting for ${what}\n--- transcript ---\n${visible(read())}`);
  };
  const stop = async (signal: "SIGINT" | "SIGTERM"): Promise<number> => {
    const pid = Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10);
    spawnedPids.push(pid);
    process.kill(pid, signal);
    // sleep-allow: bounds the wait for a real CLI child to finish shutting down
    return Promise.race([child.exited, Bun.sleep(15_000).then(() => -1)]);
  };
  return { read, waitFor, stop, gate, type };
}

/** A transcript with its escapes made printable, for failure messages. */
function visible(bytes: string): string {
  return bytes.replaceAll(ESC, "␛").slice(-4000);
}

/** The control keys of every Kitty graphics command in a transcript, in order. */
function graphics(bytes: string): string[] {
  // oxlint-disable-next-line eslint/no-control-regex -- matching a literal APC escape
  return [...bytes.matchAll(/\x1b_G([^;\x1b]*);/gu)].map((match) => match[1] ?? "");
}

/** What she uploaded: the commands that are hers, not the startup probe's query. */
function uploads(bytes: string): string[] {
  return graphics(bytes).filter((keys) => !keys.includes("a=q"));
}

const idOf = (keys: string) => /(?:^|,)i=(\d+)/u.exec(keys)?.[1];

const FIRST_RUN = /let's get you set up\.|one look around, then we start\.|this part is quick\./u;
const RESOLVING = /a few providers deep\.|checking which mirrors are awake\.|running them down\./u;
const animated = (text: string) =>
  uploads(text).some((keys) => keys.startsWith("a=a,") && keys.includes("s=3"));
/** The frames sent for one image. Each pose has its own count. */
const framesFor = (bytes: string, id: string | undefined) =>
  uploads(bytes).filter((keys) => keys.startsWith("a=f,") && idOf(keys) === id);
/**
 * The image whose loop was started last — the one on screen.
 *
 * Not "the last transmit": a global wipe between surfaces makes her upload
 * again, and a transmit can be on the wire before its placement and frames are.
 * The run command is the last thing an upload sends, so its id is a whole one.
 */
const playing = (bytes: string) =>
  idOf(uploads(bytes).findLast((keys) => keys.startsWith("a=a,") && keys.includes("s=3")) ?? "");

describe("kanna on a kitty terminal", () => {
  test(
    "the setup wizard draws wait, animated by the terminal, and deletes it on exit",
    async () => {
      const session = await launch({ args: "--setup" });
      // The upload is written first and the cells on the render after it, so
      // "drawn" is both: the loop running and Ink having printed where.
      const bytes = await session.waitFor(
        (text) => animated(text) && text.includes(PLACEHOLDER) && FIRST_RUN.test(text),
        "her to be uploaded and placed",
      );

      const sent = uploads(bytes);
      const id = playing(bytes);
      expect(id).toBeDefined();
      const transmit = sent.find((keys) => keys.startsWith("a=t,") && idOf(keys) === id);
      // Sent, never displayed by the transmit: the cells place her.
      expect(transmit).toMatch(/^a=t,f=32,s=80,v=80,i=\d+,q=2/u);
      expect(sent.some((keys) => keys.startsWith("a=T"))).toBe(false);
      // Four rows of an unmeasured 10x20 cell: an 8x4 box, an 80px square.
      expect(sent).toContain(`a=p,U=1,i=${id},c=8,r=4,q=2`);
      // Wait's loop is four beats, so three frames follow the transmit.
      const frames = framesFor(bytes, id);
      expect(frames).toHaveLength(3);
      // Written over the base, not blended: a pixel that clears must clear.
      for (const keys of frames) expect(keys).toContain("X=1");
      // A blink is a patch around the eyes, not the frame again.
      expect(frames[0]).toMatch(/s=\d{1,2},v=\d{1,2},/u);
      expect(sent).toContain(`a=a,i=${id},s=3,v=1,q=2`);
      // Every upload is silenced: a reply would arrive on stdin as keystrokes.
      for (const keys of sent.filter((entry) => idOf(entry) === id)) expect(keys).toContain("q=2");

      // Ink printed the cells that name the image, with her line beside them.
      expect(bytes).toContain(PLACEHOLDER);
      expect(bytes).toMatch(FIRST_RUN);

      expect(await session.stop("SIGINT")).toBe(130);
      expect(uploads(session.read())).toContain(`a=d,d=I,i=${id},q=2`);
    },
    testTimeoutMs,
  );

  test(
    "reduced motion sends one drawing and no frames",
    async () => {
      const session = await launch({ args: "--setup", env: { KUNAI_REDUCED_MOTION: "1" } });
      const bytes = await session.waitFor(
        (text) => text.includes(PLACEHOLDER),
        "the placeholder cells",
      );
      const sent = uploads(bytes);
      expect(sent.filter((keys) => keys.startsWith("a=t,"))).toHaveLength(1);
      expect(sent.some((keys) => keys.startsWith("a=p,U=1"))).toBe(true);
      await session.stop("SIGINT");
      // Read again after exit: nothing was animated at any point in the run.
      const all = uploads(session.read());
      expect(all.filter((keys) => keys.startsWith("a=f,"))).toEqual([]);
      expect(all.filter((keys) => keys.startsWith("a=a,"))).toEqual([]);
    },
    testTimeoutMs,
  );

  // The hunt has to be typed: no launch flag reaches a no-results surface or a
  // held resolve. util-linux `script` forwards its stdin to the PTY; the
  // `expect` wrapper macOS uses does not, so this one flow is Linux only.
  test.skipIf(process.platform !== "linux")(
    "a typed hunt: peek over an empty search, then seek through the provider race",
    async () => {
      const session = await launch({ args: "", interactive: true });
      await session.waitFor((text) => text.includes("Search title"), "the browse shell");

      // Keys go in one transition at a time: a query and its Enter written
      // together arrive as a single chunk and read as pasted text.
      session.type("zzzz");
      await session.waitFor((text) => text.includes("search anyway"), "the typed query");
      session.type("\r");
      const empty = await session.waitFor(
        (text) => text.includes("No results for") && animated(text),
        "peek on the no-results surface",
      );
      const peek = playing(empty);
      // Peek's loop is seven beats: six frames. No other pose has that many.
      expect(framesFor(empty, peek)).toHaveLength(6);

      // Clear the query, search for something the fixture has, and pick it.
      for (const key of ["\x7f", "\x7f", "\x7f", "\x7f"]) session.type(key);
      await session.waitFor((text) => {
        // The no-results body keeps quoting the submitted search, so the
        // acknowledgement has to be the freshly redrawn input line itself.
        const inputLine = stripAnsi(text.slice(empty.length))
          .split(/\r?\n/u)
          .find((line) => /⌕/u.test(line));
        return inputLine !== undefined && !/zzzz/u.test(inputLine);
      }, "a newly rendered empty query");
      const cleared = session.read().length;
      session.type("smoke");
      await session.waitFor((text) => text.slice(cleared).includes("smoke"), "the second query");
      session.type("\r");
      await session.waitFor((text) => text.includes("Smoke Movie"), "search results");
      session.type("\r");
      const racing = await session.waitFor(
        (text) => RESOLVING.test(text) && playing(text) !== peek,
        "seek on the held resolve",
      );
      const seek = playing(racing);
      // Seek's loop is six beats: five frames.
      expect(framesFor(racing, seek)).toHaveLength(5);
      // The results list replaced the empty surface, so peek was let go of.
      expect(uploads(racing)).toContain(`a=d,d=I,i=${peek},q=2`);

      writeFileSync(session.gate, "");
      // Released, the resolve moves on and seek is no longer shown — and an
      // image that is not shown is deleted, not kept.
      await session.waitFor(
        (text) => uploads(text).includes(`a=d,d=I,i=${seek},q=2`),
        "the seek sprite to be deleted after the resolve",
      );
      await session.stop("SIGINT");
      // Whatever she was drawn as on the way out, nothing outlives the process.
      const all = uploads(session.read());
      const sentIds = new Set(all.filter((keys) => keys.startsWith("a=t,")).map(idOf));
      for (const id of sentIds) expect(all, `image ${id}`).toContain(`a=d,d=I,i=${id},q=2`);
    },
    testTimeoutMs,
  );
});

describe("kanna switched off", () => {
  for (const [name, options, plain] of [
    ["KUNAI_PET=off", { args: "--setup", env: { KUNAI_PET: "off" } }, false],
    ["--plain", { args: "--setup --plain" }, true],
    ["KUNAI_PLAIN=1", { args: "--setup", env: { KUNAI_PLAIN: "1" } }, true],
  ] as const) {
    test(
      `${name} sends no image, no placeholder cell and no line`,
      async () => {
        const session = await launch(options);
        await session.waitFor((text) => /mpv|ffmpeg|yt-dlp/u.test(text), "the setup wizard");
        await session.stop("SIGINT");
        const bytes = session.read();
        expect(uploads(bytes).filter((keys) => !keys.startsWith("a=d,"))).toEqual([]);
        expect(bytes).not.toContain(PLACEHOLDER);
        expect(bytes).not.toMatch(FIRST_RUN);
        // Plain mode drops the brand emoji too; `KUNAI_PET=off` retires the
        // companion and leaves the header's own label alone.
        if (plain) expect(bytes).not.toContain("🦊");
      },
      testTimeoutMs,
    );
  }

  test(
    "a terminal with no graphics protocol gets the glyph and the line, and no escapes",
    async () => {
      const session = await launch({
        args: "--setup",
        env: { KITTY_WINDOW_ID: "", TERM: "xterm-256color", KUNAI_IMAGE_PROTOCOL: "none" },
      });
      const bytes = await session.waitFor((text) => FIRST_RUN.test(text), "her first-run line");
      await session.stop("SIGINT");
      expect(bytes).toContain("🦊");
      expect(uploads(session.read()).filter((keys) => !keys.startsWith("a=d,"))).toEqual([]);
      expect(session.read()).not.toContain(PLACEHOLDER);
    },
    testTimeoutMs,
  );
});
