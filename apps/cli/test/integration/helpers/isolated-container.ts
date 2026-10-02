import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Container } from "@/container";
import { getKunaiPaths, type KunaiPaths, type StoragePlatform } from "@kunai/storage";

import { applyStorageRootEnv, storageRootEnv } from "../../helpers/storage-env";

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
  readonly dispose: () => Promise<void>;
}> {
  const profile = createIsolatedCliProfile(label);
  // applyStorageRootEnv returns the undo: the env swap must be reversed on
  // dispose or the next container in this worker resolves paths inside the
  // deleted profile — the closed-DB flake's other half.
  const restoreEnv = applyStorageRootEnv(profile.rootDir);
  const { createContainer, disposeContainer } = await import("@/container");
  const container = await createContainer();
  return {
    container,
    profile,
    dispose: async () => {
      // Route through the real dispose path: it drains the scheduler, sync,
      // and download workers, unbinds the network observer, and only then
      // closes the databases. Closing the handles directly would leave a
      // mid-flight queue pass (or the bound observer) writing into a dead
      // store — the flake this helper exists to prevent.
      await disposeContainer(container);
      restoreEnv();
      disposeIsolatedCliProfile(profile);
    },
  };
}
