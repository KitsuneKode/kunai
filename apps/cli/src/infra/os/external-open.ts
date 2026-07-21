import { dirname } from "node:path";

export type ExternalOpenTarget =
  | { readonly kind: "url"; readonly url: string }
  | { readonly kind: "path"; readonly path: string };

export type ExternalOpenFailureReason =
  | "disabled"
  | "unsupported-platform"
  | "opener-not-found"
  | "spawn-failed"
  | "non-zero-exit";

export type ExternalOpenResult =
  | { readonly ok: true; readonly command: readonly string[]; readonly target: ExternalOpenTarget }
  | {
      readonly ok: false;
      readonly reason: ExternalOpenFailureReason;
      readonly target: ExternalOpenTarget;
      readonly detail?: string;
    };

export type ExternalOpenRuntime = {
  readonly platform: NodeJS.Platform;
  readonly which: (command: string) => string | null;
  readonly spawn: (
    command: string[],
    options?: Parameters<typeof Bun.spawn>[1],
  ) => { readonly exited: Promise<number> };
  readonly isDisabled?: () => boolean;
};

const DISABLE_EXTERNAL_URL_ENV = "KUNAI_DISABLE_EXTERNAL_URL";

export function isExternalOpenDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env[DISABLE_EXTERNAL_URL_ENV];
  return flag === "1" || flag === "true";
}

export const defaultExternalOpenRuntime: ExternalOpenRuntime = {
  platform: process.platform,
  which: (command) => Bun.which(command),
  spawn: (command, options) =>
    Bun.spawn(command, {
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
      ...options,
    }),
  isDisabled: () => isExternalOpenDisabled(),
};

function resolveCommand(
  target: ExternalOpenTarget,
  runtime: ExternalOpenRuntime,
):
  | { readonly ok: true; readonly command: readonly string[] }
  | { readonly ok: false; readonly reason: ExternalOpenFailureReason } {
  const { platform, which } = runtime;

  if (platform === "linux") {
    const opener = which("xdg-open");
    if (!opener) return { ok: false, reason: "opener-not-found" };
    if (target.kind === "url") return { ok: true, command: [opener, target.url] };
    return { ok: true, command: [opener, dirname(target.path)] };
  }

  if (platform === "darwin") {
    const opener = which("open");
    if (!opener) return { ok: false, reason: "opener-not-found" };
    if (target.kind === "url") return { ok: true, command: [opener, target.url] };
    return { ok: true, command: [opener, "-R", target.path] };
  }

  if (platform === "win32") {
    if (target.kind === "url") {
      const opener = which("cmd.exe") ?? which("cmd");
      if (!opener) return { ok: false, reason: "opener-not-found" };
      return { ok: true, command: [opener, "/c", "start", "", target.url] };
    }
    const opener = which("explorer.exe") ?? which("explorer");
    if (!opener) return { ok: false, reason: "opener-not-found" };
    return { ok: true, command: [opener, `/select,${target.path}`] };
  }

  return { ok: false, reason: "unsupported-platform" };
}

function failureDetail(error: unknown): string | undefined {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  if (typeof error === "string" && error.trim().length > 0) return error;
  return undefined;
}

/**
 * Open a URL or reveal a path with a single platform-correct opener.
 * Sync spawn throws and rejected `exited` promises become typed failures.
 */
export async function openExternal(
  target: ExternalOpenTarget,
  runtime: ExternalOpenRuntime = defaultExternalOpenRuntime,
): Promise<ExternalOpenResult> {
  if (runtime.isDisabled?.()) {
    return { ok: false, reason: "disabled", target };
  }

  if (target.kind === "url" && !target.url) {
    return { ok: false, reason: "opener-not-found", target, detail: "empty url" };
  }
  if (target.kind === "path" && !target.path) {
    return { ok: false, reason: "opener-not-found", target, detail: "empty path" };
  }

  const resolved = resolveCommand(target, runtime);
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason, target };
  }

  try {
    const proc = runtime.spawn([...resolved.command], {
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
    });
    let exitCode: number;
    try {
      exitCode = await proc.exited;
    } catch (error) {
      return {
        ok: false,
        reason: "spawn-failed",
        target,
        detail: failureDetail(error),
      };
    }
    if (exitCode === 0) {
      return { ok: true, command: resolved.command, target };
    }
    return {
      ok: false,
      reason: "non-zero-exit",
      target,
      detail: `exit ${exitCode}`,
    };
  } catch (error) {
    return {
      ok: false,
      reason: "spawn-failed",
      target,
      detail: failureDetail(error),
    };
  }
}
