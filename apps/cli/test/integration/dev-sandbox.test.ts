import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { storageRootEnv } from "../helpers/storage-env";

// The manual launcher is a Bash entrypoint for Linux/macOS source checkouts.
describe.skipIf(process.platform === "win32")("manual sandbox launcher", () => {
  let root: string;
  let capture: string;
  let shim: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kunai-sandbox-contract-"));
    capture = join(root, "capture.json");
    shim = join(root, "bin");
    mkdirSync(shim);
    const executable = join(shim, "bun");
    writeFileSync(
      executable,
      `#!${process.execPath}\nawait Bun.write(process.env.SANDBOX_CAPTURE, JSON.stringify({env:Object.fromEntries(["HOME", "USERPROFILE", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "APPDATA", "LOCALAPPDATA", "KUNAI_CREDENTIAL_BACKEND", "DO_NOT_TRACK"].map(key=>[key,process.env[key]])),args:process.argv.slice(2)}));\n`,
    );
    chmodSync(executable, 0o755);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  function launch(directory: string, keep = "0", args: string[] = []) {
    return Bun.spawnSync(
      ["bash", resolve(import.meta.dir, "../../../../scripts/dev-sandbox.sh"), ...args],
      {
        env: {
          ...process.env,
          ...storageRootEnv(join(root, "outer-profile")),
          PATH: `${shim}:${process.env.PATH ?? "/usr/bin:/bin"}`,
          SANDBOX_CAPTURE: capture,
          SANDBOX_DIR: directory,
          KEEP: keep,
          KUNAI_CREDENTIAL_BACKEND: "native",
          DO_NOT_TRACK: "0",
          CI: "0",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
  }
  test("isolates every profile root and forces file credentials while preserving CLI arguments", () => {
    const directory = join(root, "profile with spaces");
    const result = launch(directory, "0", ["-S", "Dune", "--debug"]);
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    const recorded = JSON.parse(readFileSync(capture, "utf8"));
    for (const [key, value] of Object.entries(storageRootEnv(directory)))
      expect(recorded.env[key]).toBe(value);
    expect(recorded.args.slice(1)).toEqual(["-S", "Dune", "--debug"]);
    expect(lstatSync(directory).mode & 0o777).toBe(0o700);
  });
  test("refuses a nonempty unmarked directory before deleting anything", () => {
    const directory = join(root, "unrelated");
    mkdirSync(directory);
    const precious = join(directory, "keep.txt");
    writeFileSync(precious, "unrelated work");
    expect(launch(directory).exitCode).not.toBe(0);
    expect(readFileSync(precious, "utf8")).toBe("unrelated work");
    expect(existsSync(capture)).toBe(false);
  });
  test("refuses a symlink before unlinking it or writing through it", () => {
    const target = join(root, "target");
    const directory = join(root, "link");
    mkdirSync(target);
    writeFileSync(join(target, "keep.txt"), "safe");
    symlinkSync(target, directory, "dir");
    expect(launch(`${directory}/`).exitCode).not.toBe(0);
    expect(lstatSync(directory).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(target, "keep.txt"), "utf8")).toBe("safe");
  });
  test("refuses an invalid or linked ownership marker", () => {
    const directory = join(root, "bad-marker");
    mkdirSync(directory);
    const marker = join(directory, ".kunai-dev-sandbox");
    writeFileSync(marker, "not a sandbox\n");
    expect(launch(directory).exitCode).not.toBe(0);
    expect(readFileSync(marker, "utf8")).toBe("not a sandbox\n");
    rmSync(marker);
    const target = join(root, "marker-target");
    writeFileSync(target, "kunai-dev-sandbox-v1\n");
    symlinkSync(target, marker);
    expect(launch(directory).exitCode).not.toBe(0);
    expect(lstatSync(marker).isSymbolicLink()).toBe(true);
  });
  test("KEEP retains an owned sandbox and fresh mode resets only that sandbox", () => {
    const directory = join(root, "managed");
    expect(launch(directory).exitCode).toBe(0);
    const config = join(directory, "fixture.json");
    writeFileSync(config, "retained");
    expect(launch(directory, "1").exitCode).toBe(0);
    expect(readFileSync(config, "utf8")).toBe("retained");
    expect(launch(directory).exitCode).toBe(0);
    expect(existsSync(config)).toBe(false);
  });
  test("KEEP refuses unrelated directories too", () => {
    const directory = join(root, "unrelated-keep");
    mkdirSync(directory);
    writeFileSync(join(directory, "keep.txt"), "safe");
    expect(launch(directory, "1").exitCode).not.toBe(0);
    expect(existsSync(capture)).toBe(false);
  });
});
