import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

async function isInsideStagingRoot(candidate: string): Promise<boolean> {
  const script = [
    "set -u",
    'CACHE_DIR="/home/u/.cache/kunai"',
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

  test("rejects the staging root itself and anything outside it", async () => {
    expect(await isInsideStagingRoot(ROOT_DIR)).toBe(false);
    expect(await isInsideStagingRoot("/etc")).toBe(false);
    expect(await isInsideStagingRoot("/home/u/.ssh")).toBe(false);
    expect(await isInsideStagingRoot("")).toBe(false);
  });
});
