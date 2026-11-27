import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// VHS tapes launch real processes from a recorder shell. That shell is not a
// `bun test` worker, so the test preload's profile guard never sees it: a tape
// that types `bun run dev` reads and migrates the developer's live profile, and
// `setup.tape` walks the setup wizard, which writes. Every tape therefore
// launches through `isolated-kunai.sh`, which redirects every storage root.
const VHS_DIR = join(import.meta.dir, "../../vhs");
const CLI_ROOT = join(import.meta.dir, "../../..");
const PATHS_MODULE = join(CLI_ROOT, "../../packages/storage/src/paths.ts");
const WRAPPER = join(VHS_DIR, "isolated-kunai.sh");
const tapes = readdirSync(VHS_DIR).filter((f) => f.endsWith(".tape"));
const readTape = (tape: string) => readFileSync(join(VHS_DIR, tape), "utf8");

/** Every command a tape types into the recorder shell, minus housekeeping. */
function launchCommands(body: string): string[] {
  return [...body.matchAll(/^Type "([^"]+)"/gm)]
    .map((m) => m[1] ?? "")
    .filter((typed) => /^(\.\/|bun\b|bunx\b|kunai\b)/.test(typed));
}

describe("VHS tapes never touch the real profile", () => {
  test("there is at least one tape to check", () => {
    expect(tapes.length).toBeGreaterThan(0);
  });

  for (const tape of tapes) {
    test(`${tape} launches only through the isolated wrapper`, () => {
      const commands = launchCommands(readTape(tape));
      expect(commands.length).toBeGreaterThan(0);
      for (const command of commands) {
        expect(command).toStartWith("./test/vhs/isolated-kunai.sh");
      }
    });
  }
});

// `Wait+Screen` patterns are how the tapes stay off real sleeps, but they rot
// silently: the tapes are opt-in and never run in CI. `setup.tape` waited on
// "Terminal-first streaming" long after that copy was gone, so every run timed
// out. Pin each pattern of a tape that drives the real CLI to text that still
// exists in the shell. Harness tapes (`--harness`) are left out: they wait on
// fixture text the harness composes at runtime ("3 titles", "direct · videasy").
describe("VHS tape wait patterns still match the UI", () => {
  const SRC = join(CLI_ROOT, "src");
  const sourceContains = (needle: string) =>
    Bun.spawnSync(["grep", "-rqF", "--", needle, SRC]).exitCode === 0;
  const cliTapes = tapes.filter((tape) =>
    launchCommands(readTape(tape)).some((command) => !command.includes("--harness")),
  );

  const patterns = cliTapes.flatMap((tape) =>
    [...readTape(tape).matchAll(/Wait\+Screen(?:@\S+)? \/([^/]+)\//g)].map((m) => ({
      tape,
      pattern: m[1] ?? "",
    })),
  );

  test("the tapes declare at least one wait pattern", () => {
    expect(patterns.length).toBeGreaterThan(0);
  });

  for (const { tape, pattern } of patterns) {
    test(`${tape} waits on text that exists: "${pattern}"`, () => {
      expect(sourceContains(pattern)).toBe(true);
    });
  }
});

// Exercise the wrapper itself: a harness script reports the environment it was
// given, and the sandbox it ran in must be gone once the wrapper exits.
const ROOT_KEYS = [
  "KUNAI_CONFIG_DIR",
  "HOME",
  "USERPROFILE",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
  "APPDATA",
  "LOCALAPPDATA",
  "TMPDIR",
];

describe.skipIf(process.platform === "win32")("isolated-kunai.sh", () => {
  test("redirects every storage root into a sandbox it removes on exit", () => {
    const scratch = mkdtempSync(join(tmpdir(), "kunai-vhs-wrapper-test-"));
    try {
      const probe = join(scratch, "probe.ts");
      // One `key=value` line per fact, so the report needs no typed JSON parse.
      writeFileSync(
        probe,
        `const keys = ${JSON.stringify([...ROOT_KEYS, "DO_NOT_TRACK", "KUNAI_CREDENTIAL_BACKEND"])};
for (const key of keys) console.log(key + "=" + (process.env[key] ?? ""));
// Read the seed where the CLI will, not where Linux keeps it: macOS ignores XDG.
const { getKunaiPaths } = await import(${JSON.stringify(PATHS_MODULE)});
const config = await Bun.file(getKunaiPaths().configPath).json();
console.log("config.analytics=" + config.analytics);
console.log("config.installId=" + config.installId);
console.log("args=" + process.argv.slice(2).join(" "));
`,
      );
      const result = Bun.spawnSync([WRAPPER, "--harness", probe, "--flag"], {
        env: { ...process.env, TMPDIR: scratch },
      });
      expect(result.stderr.toString()).toBe("");
      expect(result.exitCode).toBe(0);

      const report = new Map(
        result.stdout
          .toString()
          .trim()
          .split("\n")
          .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
      );
      const sandbox = report.get("HOME") ?? "";
      expect(sandbox).toStartWith(join(scratch, "kunai-vhs."));
      for (const key of ROOT_KEYS) expect(report.get(key), key).toStartWith(sandbox);
      expect(report.get("DO_NOT_TRACK")).toBe("1");
      expect(report.get("KUNAI_CREDENTIAL_BACKEND")).toBe("file");
      expect(report.get("args")).toBe("--flag");

      // A tape is not a keystroke: the seed never enables analytics or mints an ID.
      expect(report.get("config.analytics")).toBe("unset");
      expect(report.get("config.installId")).toBe("");

      expect(existsSync(sandbox)).toBe(false);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test("a later launch removes sandboxes whose owner died, and only those", () => {
    const scratch = mkdtempSync(join(tmpdir(), "kunai-vhs-wrapper-test-"));
    try {
      const probe = join(scratch, "probe.ts");
      writeFileSync(probe, "");
      // A PID that has certainly exited stands in for a wrapper VHS killed.
      const dead = Bun.spawnSync(["true"]).pid;
      const orphan = join(scratch, "kunai-vhs.orphan");
      const live = join(scratch, "kunai-vhs.live");
      const unowned = join(scratch, "kunai-vhs.unowned");
      for (const dir of [orphan, live, unowned]) mkdirSync(dir);
      writeFileSync(join(orphan, ".owner-pid"), `${dead}\n`);
      writeFileSync(join(live, ".owner-pid"), `${process.pid}\n`);

      const result = Bun.spawnSync([WRAPPER, "--harness", probe], {
        env: { ...process.env, TMPDIR: scratch },
      });
      expect(result.exitCode).toBe(0);
      expect(existsSync(orphan)).toBe(false);
      expect(existsSync(live)).toBe(true);
      expect(existsSync(unowned)).toBe(true);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
