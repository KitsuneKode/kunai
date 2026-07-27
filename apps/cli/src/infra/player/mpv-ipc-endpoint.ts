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

function randomHex(byteCount: number): string {
  const buf = new Uint8Array(byteCount);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Unpredictable id for IPC socket/pipe paths (not `Math.random`). */
export function newMpvIpcSessionId(): string {
  return `${process.pid}-${Date.now().toString(36)}-${randomHex(4)}`;
}

/**
 * Per-session mpv IPC location.
 * - Unix: UDS file under the temp dir (Bun.env, not node:os).
 * - Windows: named pipe in the canonical Win32 spelling, `\\.\pipe\...`.
 *
 * The spelling is not cosmetic. mpv accepts only the backslash form for
 * `--input-ipc-server`; handed `//./pipe/NAME` it starts normally, reports no
 * error, and simply never creates the pipe. Kunai then failed every connect
 * attempt, read that as a dead player, and fell back — launching a second and
 * third mpv for a stream that was already playing. `Bun.connect({ unix })`
 * accepts either spelling, so the backslash form is the one that satisfies both
 * ends (verified against mpv on Windows for each combination).
 */
export function createMpvIpcEndpoint(
  sessionId: string,
  platform: NodeJS.Platform = process.platform,
): MpvIpcEndpoint {
  if (platform === "win32") {
    return {
      kind: "windows_pipe",
      path: `\\\\.\\pipe\\kunai-mpv-${ipcPipeSuffix(sessionId)}`,
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

export function mpvIpcTransportTag(endpoint: MpvIpcEndpoint): "unix" | "pipe" {
  return endpoint.kind === "unix_socket" ? "unix" : "pipe";
}

/** Appended to ipc-bootstrap failures (shell diagnostics + PlaybackPhase player notes). */
export function mpvIpcBootstrapDiagnosticsHintSuffix(): string {
  if (process.platform === "win32") {
    // Spell the pipe the way mpv requires. This hint used to print the
    // forward-slash form, which is precisely the spelling mpv accepts and never
    // binds -- so the troubleshooting text pointed at the bug as if it were the
    // fix.
    return " Windows: Bun uses a duplex named pipe (\\\\.\\pipe\\…). Use native Windows mpv on PATH in the same environment as Bun (not WSL↔host split).";
  }
  return " Unix: IPC is a socket under TMPDIR/TMP; check permissions and stale .sock files.";
}
