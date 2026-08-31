import { mkdir, rename, unlink } from "node:fs/promises";
import { join } from "node:path";

import type { MobileStateStore } from "../../application/contracts";
import { decodeMobileState } from "../../application/mobile-state";

export interface AndroidStateRuntime {
  readonly ensureDirectory: (path: string) => Promise<void>;
  readonly readText: (path: string) => Promise<string | undefined>;
  readonly writeText: (path: string, value: string) => Promise<void>;
  readonly remove: (path: string) => Promise<void>;
  readonly move: (from: string, to: string) => Promise<void>;
}

async function removeIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
}

export const defaultAndroidStateRuntime: AndroidStateRuntime = {
  ensureDirectory: async (path) => mkdir(path, { recursive: true }).then(() => undefined),
  readText: async (path) => {
    const file = Bun.file(path);
    return (await file.exists()) ? file.text() : undefined;
  },
  writeText: async (path, value) => {
    await Bun.write(path, value);
  },
  remove: removeIfPresent,
  move: rename,
};

function parseStateJson(value: string): ReturnType<typeof decodeMobileState> {
  try {
    return decodeMobileState(JSON.parse(value));
  } catch {
    throw new Error("Invalid mobile state");
  }
}

export function createBunStateStore(input: {
  readonly root: string;
  readonly runtime?: AndroidStateRuntime;
}): MobileStateStore {
  const runtime = input.runtime ?? defaultAndroidStateRuntime;
  const currentPath = join(input.root, "mobile-state.json");
  const temporaryPath = `${currentPath}.tmp`;
  const previousPath = `${currentPath}.previous`;

  return {
    async load() {
      const current = await runtime.readText(currentPath);
      return current === undefined ? decodeMobileState(undefined) : parseStateJson(current);
    },
    async commit(next) {
      await runtime.ensureDirectory(input.root);
      await runtime.remove(temporaryPath);
      await runtime.writeText(temporaryPath, JSON.stringify(next));
      const staged = await runtime.readText(temporaryPath);
      if (staged === undefined) throw new Error("Mobile state staging failed");
      parseStateJson(staged);

      const current = await runtime.readText(currentPath);
      if (current !== undefined) parseStateJson(current);
      await runtime.remove(previousPath);
      if (current !== undefined) await runtime.move(currentPath, previousPath);

      try {
        await runtime.move(temporaryPath, currentPath);
      } catch (error) {
        await runtime.remove(temporaryPath);
        if ((await runtime.readText(previousPath)) !== undefined) {
          await runtime.move(previousPath, currentPath);
        }
        throw error;
      }
      await runtime.remove(previousPath);
    },
  };
}
