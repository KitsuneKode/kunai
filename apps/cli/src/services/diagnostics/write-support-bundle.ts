import { join } from "node:path";

import { writeAtomicJson } from "@/infra/fs/atomic-write";
import { cacheMigrations, dataMigrations } from "@kunai/storage";

import type { DiagnosticsSupportBundle, DiagnosticsBundleEnvironment } from "./support-bundle";

export const SUPPORT_BUNDLE_FILE_PREFIX = "kunai-support-bundle-";

export type WriteSupportBundleResult = {
  readonly path: string;
  readonly fileName: string;
};

/** Build a cwd-relative support-bundle filename the user can see and open. */
export function buildSupportBundleFileName(now: Date = new Date()): string {
  return `${SUPPORT_BUNDLE_FILE_PREFIX}${now.toISOString().replace(/[:.]/g, "-")}.json`;
}

export function resolveSupportBundlePath(
  directory: string = process.cwd(),
  now: Date = new Date(),
): WriteSupportBundleResult {
  const fileName = buildSupportBundleFileName(now);
  return { fileName, path: join(directory, fileName) };
}

/** Write a redacted support bundle to disk. Does not upload or offer upload. */
export async function writeSupportBundleFile(input: {
  readonly bundle: DiagnosticsSupportBundle;
  readonly directory?: string;
  readonly now?: Date;
}): Promise<WriteSupportBundleResult> {
  const target = resolveSupportBundlePath(
    input.directory ?? process.cwd(),
    input.now ?? new Date(),
  );
  await writeAtomicJson(target.path, input.bundle);
  return target;
}

export function buildDeclaredSchemaVersions(): DiagnosticsBundleEnvironment["schemaVersions"] {
  return {
    data: dataMigrations.map((migration) => migration.id),
    cache: cacheMigrations.map((migration) => migration.id),
  };
}

export function resolveEnabledProviderIds(
  providers: Record<string, { enabled?: boolean } | undefined> | null | undefined,
  registeredIds: readonly string[],
): readonly string[] {
  const overrides = providers ?? {};
  return registeredIds.filter((id) => overrides[id]?.enabled !== false);
}

export function resolveTerminalName(input?: {
  readonly imageTerminal?: string | null;
  readonly env?: NodeJS.ProcessEnv;
}): string | null {
  const env = input?.env ?? process.env;
  if (input?.imageTerminal && input.imageTerminal.length > 0) return input.imageTerminal;
  if (typeof env.TERM_PROGRAM === "string" && env.TERM_PROGRAM.length > 0) return env.TERM_PROGRAM;
  if (typeof env.TERM === "string" && env.TERM.length > 0) return env.TERM;
  return null;
}

/** Best-effort local mpv version probe. Never throws; safe for CLI export path. */
export async function probeMpvVersion(): Promise<string | null> {
  if (!Bun.which("mpv")) return null;
  try {
    const proc = Bun.spawn(["mpv", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    const timeout = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // ignore
      }
    }, 2_000);
    try {
      const text = await new Response(proc.stdout).text();
      await proc.exited;
      const line = text.split("\n").find((entry) => entry.trim().length > 0);
      return line?.trim() ?? null;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
}
