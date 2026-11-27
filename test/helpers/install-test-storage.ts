import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { storageRootEnv } from "./storage-env";

export function installTestStorageIsolation(): void {
  const root = mkdtempSync(join(tmpdir(), "kunai-test-profile-"));
  Object.assign(process.env, storageRootEnv(root));
  const cleanup = () => rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  try {
    afterAll(cleanup);
  } catch {
    // The CLI privacy integration also imports its preload from plain Bun.
    process.once("exit", cleanup);
  }
}
