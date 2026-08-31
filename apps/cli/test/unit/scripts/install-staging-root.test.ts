import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDirs: string[] = [];

const ROOT = join(import.meta.dir, "../../../../..");
const INSTALL_SH = readFileSync(join(ROOT, "install.sh"), "utf8");

/**
 * `install.sh` ends in a bare `main "$@"`, so sourcing it runs the installer.
 * The function is extracted from the real file instead of being copied here —
 * a copy would keep passing after the original drifted, which for a guard in
 * front of `rm -rf` is the failure mode that matters.
 */
function extractShellFunction(name: string): string {
  const start = INSTALL_SH.indexOf(`${name}() {`);
  if (start < 0) throw new Error(`install.sh no longer defines ${name}()`);
  const end = INSTALL_SH.indexOf("\n}\n", start);
  if (end < 0) throw new Error(`could not find the end of ${name}()`);
  return INSTALL_SH.slice(start, end + 3);
}

async function isInsideStagingRoot(
  candidate: string,
  cacheDir = "/home/u/.cache/kunai",
): Promise<boolean> {
  const script = [
    "set -u",
    `CACHE_DIR=${JSON.stringify(cacheDir)}`,
    extractShellFunction("is_inside_staging_root"),
    'if is_inside_staging_root "$1"; then echo ACCEPT; else echo REJECT; fi',
  ].join("\n");

  const proc = Bun.spawn(["bash", "-c", script, "bash", candidate], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = (await new Response(proc.stdout).text()).trim();
  await proc.exited;
  if (out !== "ACCEPT" && out !== "REJECT") {
    throw new Error(`unexpected guard output: ${out}${await new Response(proc.stderr).text()}`);
  }
  return out === "ACCEPT";
}

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("install.sh is_inside_staging_root", () => {
  const ROOT_DIR = "/home/u/.cache/kunai/staging";

  test("accepts a real staging directory", async () => {
    expect(await isInsideStagingRoot(`${ROOT_DIR}/0.3.0`)).toBe(true);
    expect(await isInsideStagingRoot(`${ROOT_DIR}/0.3.0/nested`)).toBe(true);
  });

  test("rejects traversal out of the staging root", async () => {
    // The record is same-user writable and what happens next is `rm -rf`, so a
    // path that starts with the root but resolves elsewhere must not be honoured.
    expect(await isInsideStagingRoot(`${ROOT_DIR}/../../../.ssh`)).toBe(false);
    expect(await isInsideStagingRoot(`${ROOT_DIR}/..`)).toBe(false);
    expect(await isInsideStagingRoot(`${ROOT_DIR}/0.3.0/../../../..`)).toBe(false);
  });

  test("rejects a sibling that merely shares the prefix", async () => {
    // The old test was a bare string prefix with no `/` boundary.
    expect(await isInsideStagingRoot(`${ROOT_DIR}-old`)).toBe(false);
    expect(await isInsideStagingRoot(`${ROOT_DIR}evil/x`)).toBe(false);
  });

  test("rejects a staging directory that is a symlink out of the cache", async () => {
    // The textual checks cannot see this: the name is inside the root, contains
    // no `..`, and clears the `/` boundary — but following it lands in $HOME.
    // Resolution is what closes it.
    const base = await mkdtemp(join(tmpdir(), "kunai-staging-symlink-"));
    tempDirs.push(base);
    const cache = join(base, "cache");
    const staging = join(cache, "staging");
    const outside = join(base, "outside");
    await mkdir(staging, { recursive: true });
    await mkdir(outside, { recursive: true });
    await symlink(outside, join(staging, "escape"), "dir");
    await mkdir(join(staging, "0.3.0"), { recursive: true });

    expect(await isInsideStagingRoot(join(staging, "escape"), cache)).toBe(false);
    // A real directory in the same root is still accepted, so the resolution
    // step did not simply reject everything.
    expect(await isInsideStagingRoot(join(staging, "0.3.0"), cache)).toBe(true);
  });

  test("accepts a path inside the root that does not exist yet", async () => {
    // Resolution needs the directory to exist; a name that never existed is not
    // ours to delete either way, and must not be rejected on that basis alone.
    const base = await mkdtemp(join(tmpdir(), "kunai-staging-missing-"));
    tempDirs.push(base);
    const cache = join(base, "cache");
    await mkdir(join(cache, "staging"), { recursive: true });

    expect(await isInsideStagingRoot(join(cache, "staging", "0.9.9"), cache)).toBe(true);
  });

  test("rejects the staging root itself and anything outside it", async () => {
    expect(await isInsideStagingRoot(ROOT_DIR)).toBe(false);
    expect(await isInsideStagingRoot("/etc")).toBe(false);
    expect(await isInsideStagingRoot("/home/u/.ssh")).toBe(false);
    expect(await isInsideStagingRoot("")).toBe(false);
  });
});
