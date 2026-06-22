import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Container } from "@/container";

export type IsolatedCliProfile = {
  readonly rootDir: string;
  readonly configHome: string;
  readonly dataHome: string;
  readonly cacheHome: string;
};

export function createIsolatedCliProfile(label: string): IsolatedCliProfile {
  const rootDir = mkdtempSync(join(tmpdir(), `kunai-integration-${label}-`));
  return {
    rootDir,
    configHome: join(rootDir, "config"),
    dataHome: join(rootDir, "data"),
    cacheHome: join(rootDir, "cache"),
  };
}

export function applyIsolatedCliProfile(profile: IsolatedCliProfile): void {
  process.env.XDG_CONFIG_HOME = profile.configHome;
  process.env.XDG_DATA_HOME = profile.dataHome;
  process.env.XDG_CACHE_HOME = profile.cacheHome;
}

export function disposeIsolatedCliProfile(profile: IsolatedCliProfile): void {
  rmSync(profile.rootDir, { force: true, recursive: true });
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
    dispose: () => disposeIsolatedCliProfile(profile),
  };
}
