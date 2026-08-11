import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Container } from "@/container";
import { getKunaiPaths, type KunaiPaths, type StoragePlatform } from "@kunai/storage";

import { storageRootEnv } from "../../helpers/storage-env";

export type IsolatedCliProfile = {
  readonly rootDir: string;
  readonly configHome: string;
  readonly dataHome: string;
  readonly cacheHome: string;
  readonly paths: KunaiPaths;
  readonly env: Record<string, string>;
};

function hostStoragePlatform(): StoragePlatform {
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "win32") return "win32";
  return "linux";
}

export function createIsolatedCliProfile(label: string): IsolatedCliProfile {
  const rootDir = mkdtempSync(join(tmpdir(), `kunai-integration-${label}-`));
  const env = storageRootEnv(rootDir);
  const paths = getKunaiPaths({
    platform: hostStoragePlatform(),
    homeDir: rootDir,
    env,
  });
  mkdirSync(paths.configDir, { recursive: true });
  mkdirSync(paths.dataDir, { recursive: true });
  mkdirSync(paths.cacheDir, { recursive: true });
  return {
    rootDir,
    configHome: paths.configDir,
    dataHome: paths.dataDir,
    cacheHome: paths.cacheDir,
    paths,
    env,
  };
}

export function applyIsolatedCliProfile(profile: IsolatedCliProfile): void {
  // Must run before FileStorage is first imported: that module bakes PATHS from
  // homedir()/env at load time.
  Object.assign(process.env, profile.env);
}

export function disposeIsolatedCliProfile(profile: IsolatedCliProfile): void {
  // Windows refuses to unlink a file that still has an open handle, so anything
  // that opened a database under this profile must close it before calling here
  // (see `createIsolatedContainer`). The retries cover the residual case where
  // the OS has not yet released a handle we already closed — on POSIX, where
  // unlinking an open file is legal, they never trigger.
  rmSync(profile.rootDir, { force: true, recursive: true, maxRetries: 10, retryDelay: 50 });
}

export async function createIsolatedContainer(label: string): Promise<{
  readonly container: Container;
  readonly profile: IsolatedCliProfile;
  readonly dispose: () => void;
}> {
  const profile = createIsolatedCliProfile(label);
  applyIsolatedCliProfile(profile);
  const { createContainer } = await import("@/container");
  const container = await createContainer();
  return {
    container,
    profile,
    dispose: () => {
      // Close before unlinking: the container holds open SQLite handles inside
      // the profile directory, and on Windows those make the whole tree
      // undeletable (EBUSY).
      for (const db of [container.cacheDb, container.dataDb]) {
        try {
          db.close();
        } catch {
          // Already closed, or never opened — disposal must not mask the real
          // assertion failure that may have brought us here.
        }
      }
      disposeIsolatedCliProfile(profile);
    },
  };
}
