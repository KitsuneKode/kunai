import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as mpvDiscovery from "@/infra/player/mpv-discovery";
import { checkDeps } from "@/ui";
import { getKunaiPaths } from "@kunai/storage";

import { applyStorageRootEnv } from "../helpers/storage-env";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const undo of cleanup.splice(0)) undo();
});

async function isolatedRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kunai-cap-notice-"));
  cleanup.push(() => void rm(root, { recursive: true, force: true }));
  cleanup.push(applyStorageRootEnv(root));
  return root;
}

describe("capability notice state", () => {
  test("writes the notice under the isolated storage root, not a baked import-time path", async () => {
    const root = await isolatedRoot();

    const originalError = console.error;
    console.error = () => {};
    try {
      await checkDeps("0.0.0-test", { silent: false });
    } finally {
      console.error = originalError;
    }

    // If NOTICE_DIR were still resolved at module load, this file would land
    // in the developer's real config dir instead of the isolated root.
    const noticeFile = join(getKunaiPaths().configDir, "capability-notice.json");
    expect(noticeFile.startsWith(root)).toBe(true);
    expect(existsSync(noticeFile)).toBe(true);
  });

  test("a read-only config dir warns once instead of crashing launch", async () => {
    if (process.platform === "win32") return; // chmod read-only has different semantics
    await isolatedRoot();
    const configDir = getKunaiPaths().configDir;
    await mkdir(configDir, { recursive: true });
    await chmod(configDir, 0o555);
    cleanup.push(() => void chmod(configDir, 0o755).catch(() => {}));

    const lines: string[] = [];
    const originalError = console.error;
    console.error = (line: string) => lines.push(String(line));
    try {
      // Resolved, not a thrown EACCES that escaped as an unhandled rejection
      // before the shell could mount.
      const snapshot = await checkDeps("0.0.0-test", { silent: false });
      expect(snapshot).toBeDefined();
    } finally {
      console.error = originalError;
    }

    const notice = lines.find((line) => line.includes("could not record capability state"));
    expect(notice).toBeDefined();
    // The path in the warning is home-redacted, matching every other surface.
    expect(notice).not.toContain(configDir);
  });

  test("missing mpv is announced once on first launch", async () => {
    await isolatedRoot();
    const discovery = spyOn(mpvDiscovery, "discoverMpvInvocation").mockReturnValue(null);
    const lines: string[] = [];
    const originalError = console.error;
    const originalLog = console.log;
    console.error = (line: string) => lines.push(String(line));
    console.log = (line: string) => lines.push(String(line));
    try {
      await checkDeps("0.0.0-test", { silent: false });
    } finally {
      console.error = originalError;
      console.log = originalLog;
      discovery.mockRestore();
    }

    const mpv = lines.filter((line) => line.includes("mpv not found"));
    expect(mpv).toHaveLength(1);
  });
});
