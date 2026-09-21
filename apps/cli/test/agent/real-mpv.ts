/**
 * Real-mpv tier — the deepest "it actually works" the harness can reach.
 *
 *   generated mp4 (ffmpeg) → Bun.serve on 127.0.0.1 → fixture provider resolves
 *   the stream URL via KUNAI_SMOKE_MEDIA_BASE → the app spawns the REAL mpv
 *   through a PATH wrapper that adds --vo=null --ao=null → mpv decodes real
 *   bytes → Kunai's own IPC client reads time-pos → history row lands in
 *   SQLite.
 *
 * Two independent witnesses, so "playback" is never claimed on argv alone:
 *   1. the mpv IPC socket's `time-pos` advancing (mpv says it played), and
 *   2. the app's own watch-progress/history write (Kunai says it noticed).
 *
 * Opt-in like every heavy tier: `KUNAI_REAL_MPV=1` AND `mpv`/`ffmpeg`/`tmux`
 * on PATH, else `realMpvStatus()` reports a skip reason — call sites skip
 * loudly, never silently pass. Headless flags ride on the wrapper so the
 * app's own argv stays untouched.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  createIsolatedCliProfile,
  type IsolatedCliProfile,
} from "../integration/helpers/isolated-container";
import { startTmuxSession, type TmuxSession, type TmuxSessionOptions } from "./tmux-session";

const MEDIA_SECONDS = 8;

export function realMpvStatus(): { ok: true } | { ok: false; reason: string } {
  if (process.env.KUNAI_REAL_MPV !== "1") {
    return { ok: false, reason: "KUNAI_REAL_MPV=1 not set" };
  }
  if (!Bun.which("mpv")) return { ok: false, reason: "mpv not on PATH" };
  if (!Bun.which("ffmpeg")) return { ok: false, reason: "ffmpeg not on PATH" };
  if (!Bun.which("tmux")) return { ok: false, reason: "tmux not on PATH" };
  return { ok: true };
}

export interface RealMpvSession {
  readonly session: TmuxSession;
  /** mpv's own word: current time-pos in seconds, or null if no socket yet. */
  mpvTimePos(): Promise<number | null>;
  /** Generated fixture media location (inside the sandbox). */
  readonly mediaDir: string;
  stop(): Promise<void>;
}

async function generateMedia(path: string): Promise<void> {
  const ffmpeg = Bun.which("ffmpeg");
  if (!ffmpeg) throw new Error("ffmpeg not on PATH");
  const proc = Bun.spawn(
    [
      ffmpeg,
      "-y",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=size=320x240:rate=10:duration=${MEDIA_SECONDS}`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:duration=${MEDIA_SECONDS}`,
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-loglevel",
      "error",
      path,
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  const err = await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code !== 0 || !existsSync(path)) {
    throw new Error(`ffmpeg fixture generation failed (${code}): ${err.trim()}`);
  }
}

/**
 * Start an L3 tmux session whose playback path ends at REAL mpv decoding a
 * generated file over loopback HTTP. Everything the tmux driver provides —
 * seeded profile, fixture providers, real keystrokes — applies unchanged; the
 * only difference is who answers `mpv` on PATH and where stream URLs point.
 */
export async function startRealMpvSession(
  options: Omit<TmuxSessionOptions, "fakeMpv" | "profile" | "pathPrefix"> = {},
): Promise<RealMpvSession> {
  const status = realMpvStatus();
  if (!status.ok) throw new Error(`real-mpv tier unavailable: ${status.reason}`);

  const profile = createIsolatedCliProfile(options.name ?? "real-mpv");

  const mediaDir = join(profile.rootDir, "media");
  const binDir = join(profile.rootDir, "real-mpv-bin");
  const runDir = join(profile.rootDir, "run");
  const tmpDir = join(profile.rootDir, "tmp");
  mkdirSync(mediaDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  mkdirSync(runDir, { recursive: true, mode: 0o700 });
  mkdirSync(tmpDir, { recursive: true });

  const mediaPath = join(mediaDir, "fixture.mp4");
  await generateMedia(mediaPath);

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Response(Bun.file(mediaPath), { headers: { "content-type": "video/mp4" } }),
  });

  const realMpv = Bun.which("mpv");
  if (!realMpv) {
    server.stop(true);
    throw new Error("real-mpv tier requires `mpv` on PATH (gate: KUNAI_REAL_MPV=1)");
  }
  writeFileSync(
    join(binDir, "mpv"),
    `#!/bin/sh\nexec ${JSON.stringify(realMpv)} --vo=null --ao=null "$@"\n`,
    { mode: 0o755 },
  );

  let session: TmuxSession;
  try {
    session = await startTmuxSession({
      ...options,
      profile,
      fakeMpv: false,
      pathPrefix: binDir,
      env: {
        // Fixture stream URLs remap onto the loopback server.
        KUNAI_SMOKE_MEDIA_BASE: `http://127.0.0.1:${server.port}`,
        // Land the IPC socket inside the sandbox so the witness can find it.
        XDG_RUNTIME_DIR: runDir,
        TMPDIR: tmpDir,
        ...options.env,
      },
    });
  } catch (error) {
    server.stop(true);
    throw error;
  }

  return {
    session,
    mediaDir,
    mpvTimePos: () => readMpvTimePos(profile),
    async stop() {
      try {
        await session.stop();
      } finally {
        server.stop(true);
      }
    },
  };
}

/** Discover the Kunai mpv IPC socket inside the sandbox and ask for time-pos. */
export async function readMpvTimePos(profile: IsolatedCliProfile): Promise<number | null> {
  const candidates = [
    join(profile.rootDir, "run", "kunai"),
    join(profile.rootDir, "tmp", "kunai-ipc"),
  ];
  for (const dir of candidates) {
    if (!existsSync(dir)) continue;
    const socks = readdirSync(dir).filter((f) => f.startsWith("kunai-mpv-") && f.endsWith(".sock"));
    for (const sock of socks) {
      const pos = await queryTimePos(join(dir, sock));
      if (pos !== null) return pos;
    }
  }
  return null;
}

async function queryTimePos(socketPath: string): Promise<number | null> {
  try {
    const response = await new Promise<string>((resolvePromise, reject) => {
      const timeout = setTimeout(() => reject(new Error("time-pos query timed out")), 3000);
      let buffer = "";
      Bun.connect({
        unix: socketPath,
        socket: {
          data(_socket, data) {
            buffer += data.toString("utf8");
            const nl = buffer.indexOf("\n");
            if (nl >= 0) {
              clearTimeout(timeout);
              resolvePromise(buffer.slice(0, nl));
            }
          },
          error(_socket, err) {
            clearTimeout(timeout);
            reject(err);
          },
          connectError(_socket, err) {
            clearTimeout(timeout);
            reject(err);
          },
          open(socket) {
            socket.write(`${JSON.stringify({ command: ["get_property", "time-pos"] })}\n`);
          },
        },
      }).catch((err: unknown) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
    const parsed = JSON.parse(response) as { data?: number; error?: string };
    return typeof parsed.data === "number" ? parsed.data : null;
  } catch {
    return null;
  }
}
