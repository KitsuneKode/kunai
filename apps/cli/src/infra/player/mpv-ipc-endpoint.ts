import { join } from "node:path";

/** Where Bun connects for mpv JSON IPC (`--input-ipc-server` value). */
export type MpvIpcEndpoint =
  | { kind: "unix_socket"; path: string }
  | { kind: "windows_pipe"; path: string };

function ipcPipeSuffix(sessionId: string): string {
  const safe = sessionId.replace(/[^A-Za-z0-9]/g, "");
  return (safe.length > 0 ? safe : "kunai").slice(0, 48);
}

function unixSocketTempDir(): string {
  return Bun.env.TMPDIR ?? Bun.env.TMP ?? "/tmp";
}

/**
 * Per-session mpv IPC location.
 * - Unix: UDS file under the temp dir (Bun.env, not node:os).
 * - Windows: named pipe using `//./pipe/...` so the same path works for mpv and for
 *   `Bun.connect({ unix: path })` (Bun’s supported pipe spelling; see Bun #14329).
 */
export function createMpvIpcEndpoint(sessionId: string): MpvIpcEndpoint {
  if (process.platform === "win32") {
    return {
      kind: "windows_pipe",
      path: `//./pipe/kunai-mpv-${ipcPipeSuffix(sessionId)}`,
    };
  }
  return {
    kind: "unix_socket",
    path: join(unixSocketTempDir(), `kunai-mpv-${sessionId}.sock`),
  };
}

export function ipcServerCliArg(endpoint: MpvIpcEndpoint): string {
  return endpoint.path;
}

export function shouldUnlinkUnixSocket(endpoint: MpvIpcEndpoint): boolean {
  return endpoint.kind === "unix_socket";
}
