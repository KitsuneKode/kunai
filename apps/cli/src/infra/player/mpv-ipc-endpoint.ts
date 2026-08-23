import { mkdirSync } from "node:fs";
import { posix as posixPath } from "node:path";

/** Where Bun connects for mpv JSON IPC (`--input-ipc-server` value). */
export type MpvIpcEndpoint =
  | { kind: "unix_socket"; path: string }
  | { kind: "windows_pipe"; path: string };

function ipcPipeSuffix(sessionId: string): string {
  const safe = sessionId.replace(/[^A-Za-z0-9]/g, "");
  return (safe.length > 0 ? safe : "kunai").slice(0, 48);
}

/**
 * Longest a Unix domain socket path may be.
 *
 * `sun_path` is 108 bytes on Linux and 104 on macOS, including the NUL. Bind
 * fails outright past that, so the shorter limit is the one to respect — and a
 * long `XDG_RUNTIME_DIR` plus a session id can genuinely reach it.
 */
const MAX_UNIX_SOCKET_PATH_BYTES = 100;

/**
 * Directory for the mpv IPC socket, most private first.
 *
 * The socket used to sit directly in the shared temp dir. To be precise about
 * why that is worth changing, since the usual reasoning is wrong: connect
 * permission on a Unix domain socket comes from the socket inode's own mode,
 * not from the directory, and mpv creates it under the invoking umask. Under a
 * standard `umask 022` the socket is `srwxr-xr-x` and another local user cannot
 * connect. `/tmp` is sticky too, and `newMpvIpcSessionId` is unguessable.
 *
 * What is actually true: on systems with `umask 002` — user-private-group
 * distros — the socket is group-writable, and mpv's JSON IPC exposes `run`, so
 * a same-group process gets arbitrary command execution as the user. Narrow,
 * but real, and a private directory costs nothing.
 *
 * `XDG_RUNTIME_DIR` is 0700 and per-user by definition. It is **not set on
 * macOS**, where `TMPDIR` is already per-user (`/var/folders/…`); the 0700
 * subdirectory covers both that and any Linux box without a runtime dir.
 */
export function mpvIpcSocketDirCandidates(
  env: Record<string, string | undefined> = Bun.env,
): readonly string[] {
  const tempDir = env.TMPDIR ?? env.TMP ?? "/tmp";
  const runtimeDir = env.XDG_RUNTIME_DIR?.trim();
  // `posix.join`, not `join`: a Unix domain socket path is POSIX by definition,
  // and plain `join` follows the *host* platform. On a Windows host it emits
  // backslashes, which is meaningless for a UDS. Production never reaches here
  // on win32 (named pipes return earlier), but building a POSIX path with a
  // platform-dependent joiner is wrong regardless of who calls it — and it is
  // what made these tests fail on the Windows runner.
  return [
    ...(runtimeDir ? [posixPath.join(runtimeDir, "kunai")] : []),
    posixPath.join(tempDir, "kunai-ipc"),
    tempDir,
  ];
}

/**
 * First candidate directory that exists at 0700 and yields a bindable path.
 *
 * Creating the directory is a deliberate side effect of resolving the endpoint:
 * mpv binds the socket itself, so the parent has to be there first. Each step
 * is best-effort — an unwritable `XDG_RUNTIME_DIR` falls through rather than
 * failing the launch, and the last candidate is the bare temp dir, which is
 * where this lived before, so the worst case is the old behaviour.
 */
function resolveUnixSocketPath(
  sessionId: string,
  env: Record<string, string | undefined>,
  makeDir: (path: string) => void,
): string {
  const fileName = `kunai-mpv-${sessionId}.sock`;
  const candidates = mpvIpcSocketDirCandidates(env);

  for (const [index, dir] of candidates.entries()) {
    const candidate = posixPath.join(dir, fileName);
    if (Buffer.byteLength(candidate, "utf8") >= MAX_UNIX_SOCKET_PATH_BYTES) continue;
    // The final candidate is the plain temp dir, which already exists.
    if (index < candidates.length - 1) {
      try {
        makeDir(dir);
      } catch {
        continue;
      }
    }
    return candidate;
  }

  // Every candidate was too long or unusable. Fall back to the shortest path
  // that can still bind rather than returning something that cannot.
  return posixPath.join("/tmp", fileName);
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
  options: {
    readonly env?: Record<string, string | undefined>;
    /** Injectable for tests; creates the directory owner-only. */
    readonly makeDir?: (path: string) => void;
  } = {},
): MpvIpcEndpoint {
  if (platform === "win32") {
    // Named pipes are per-session in the Windows object namespace and carry no
    // filesystem path, so none of the directory work below applies here.
    return {
      kind: "windows_pipe",
      path: `\\\\.\\pipe\\kunai-mpv-${ipcPipeSuffix(sessionId)}`,
    };
  }
  const makeDir =
    options.makeDir ?? ((path: string) => mkdirSync(path, { recursive: true, mode: 0o700 }));
  return {
    kind: "unix_socket",
    path: resolveUnixSocketPath(sessionId, options.env ?? Bun.env, makeDir),
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
  return " Unix: IPC is a socket in an owner-only directory — $XDG_RUNTIME_DIR/kunai when set, else $TMPDIR/kunai-ipc; check permissions and stale .sock files.";
}
