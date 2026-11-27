import { afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { storageRootEnv } from "./storage-env";

const PROFILE_MARKER = ".kunai-profile";
const PROFILE_MARKER_CONTENT = "kunai-profile-v1\n";

export function installTestStorageIsolation(): void {
  const root = mkdtempSync(join(tmpdir(), "kunai-test-profile-"));
  const env = storageRootEnv(root);
  const profileDir = env.KUNAI_CONFIG_DIR;
  if (!profileDir) throw new Error("storageRootEnv must name a profile root");
  // The profile root is owned before any test module resolves storage: a run
  // through the CLI startup gate expects the marker to exist already.
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(join(profileDir, PROFILE_MARKER), PROFILE_MARKER_CONTENT);
  Object.assign(process.env, env);
  const cleanup = () => rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  try {
    afterAll(cleanup);
  } catch {
    // The CLI privacy integration also imports its preload from plain Bun.
    process.once("exit", cleanup);
  }
}
