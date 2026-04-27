import { spawn } from "child_process";
import { writeFile, readFile, unlink } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// =============================================================================
// LUA REPORTER
//
// Injected via --script into every MPV session. Responsibility:
//   1. Write "seconds,duration,reason" to KITSUNE_POS_FILE on exit.
//
// Episode advancement belongs to the app loop now, not MPV itself. That keeps
// EOF behavior predictable: mpv closes cleanly, then KitsuneSnipe decides
// whether to open the next episode or return to the shell.
// =============================================================================

const LUA_REPORTER = `
local written    = false

mp.register_event("end-file", function(event)
    if written then return end
    written = true

    local pos    = mp.get_property_number("playback-time") or 0
    local dur    = mp.get_property_number("duration") or 0
    local reason = (event and event.reason) or "unknown"

    if reason == "eof" and dur > 0 and pos <= 0 then
        pos = dur
    end

    local path = os.getenv("KITSUNE_POS_FILE")
    if path then
        local f = io.open(path, "w")
        if f then
            f:write(string.format("%d,%d,%s", math.floor(pos), math.floor(dur), reason))
            f:close()
        end
    end
end)
`;

// =============================================================================
// TYPES
// =============================================================================

export type EndReason = "eof" | "quit" | "error" | "unknown";

export type PlaybackResult = {
  watchedSeconds: number;
  duration: number;
  endReason: EndReason;
};

// =============================================================================
// LAUNCHER
//
// Default behaviour (attach: false — ani-cli style):
//   MPV is launched detached with stdio ignored. The window opens
//   independently, leaving the terminal free. We poll the Lua position file
//   to know when playback ends and how far the user got.
//
// attach: true (--attach flag):
//   MPV inherits the terminal (stdin/stdout/stderr). Useful for terminal-only
//   setups where MPV renders via --vo=tty, or when you want MPV keyboard
//   shortcuts to go directly to the terminal.
// =============================================================================

export async function launchMpv(opts: {
  url: string;
  headers: Record<string, string>;
  subtitle: string | null;
  /** All available subtitle URLs. The first entry is auto-selected by mpv.
   *  User can switch tracks in mpv with j/J. */
  subtitleUrls?: readonly string[];
  displayTitle: string;
  startAt?: number;
  attach?: boolean; // true → stdio:inherit (old behaviour)
}): Promise<PlaybackResult> {
  const nonce = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const scriptPath = join(tmpdir(), `kitsune-reporter-${nonce}.lua`);
  const posPath = join(tmpdir(), `kitsune-position-${nonce}`);

  await writeFile(scriptPath, LUA_REPORTER, "utf-8");
  if (existsSync(posPath)) await unlink(posPath);

  const args: string[] = [opts.url];

  // HTTP context for CDN auth
  const referer = opts.headers["referer"] ?? opts.headers["Referer"];
  const userAgent = opts.headers["user-agent"] ?? opts.headers["User-Agent"];
  const origin = opts.headers["origin"] ?? opts.headers["Origin"];
  if (referer) args.push(`--referrer=${referer}`);
  if (userAgent) args.push(`--user-agent=${userAgent}`);
  if (origin) args.push(`--http-header-fields=Origin: ${origin}`);

  // Build deduplicated subtitle URL list: preferred first, then the rest.
  const allSubUrls: string[] = [];
  if (opts.subtitle) allSubUrls.push(opts.subtitle);
  for (const u of opts.subtitleUrls ?? []) {
    if (!allSubUrls.includes(u)) allSubUrls.push(u);
  }
  for (const u of allSubUrls) args.push(`--sub-file=${u}`);
  if (opts.startAt && opts.startAt > 5) args.push(`--start=${opts.startAt}`);
  args.push(`--force-media-title=${opts.displayTitle}`);
  args.push(`--script=${scriptPath}`);

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    KITSUNE_POS_FILE: posPath,
  };

  if (opts.attach) {
    // ── Attached mode: terminal I/O inherited, blocking ───────────────────
    await new Promise<void>((resolve) => {
      const mpv = spawn("mpv", args, { stdio: "inherit", env });
      mpv.on("close", resolve);
      mpv.on("error", (e) => {
        console.error(`\n[!] mpv: ${e.message}`);
        resolve();
      });
    });
  } else {
    // ── Detached mode (default): MPV window opens independently ──────────
    // Mirrors ani-cli's: nohup mpv ... >/dev/null 2>&1 &
    let mpvExited = false;

    const mpv = spawn("mpv", args, {
      detached: true,
      stdio: ["ignore", "ignore", "ignore"],
      env,
    });

    // Track process exit so we don't poll forever if MPV crashes before
    // the Lua reporter writes the position file.
    mpv.on("close", () => {
      mpvExited = true;
    });
    mpv.on("error", (e) => {
      console.error(`\n[!] mpv: ${e.message}`);
      mpvExited = true;
    });

    // Poll until Lua writes the position file, the process exits, or 6-hour
    // safety timeout fires (kill -9 leaves no position file, infinite loop otherwise).
    const deadline = Date.now() + 6 * 60 * 60 * 1000;
    while (!existsSync(posPath) && !mpvExited && Date.now() < deadline) {
      await Bun.sleep(500);
    }
  }

  // ── Parse position file ───────────────────────────────────────────────────
  let retries = 0;
  while (!existsSync(posPath) && retries < 5) {
    await Bun.sleep(100); // 500ms total buffer for filesystem flush
    retries++;
  }

  if (existsSync(posPath)) {
    try {
      const raw = await readFile(posPath, "utf-8");
      const parts = raw.trim().split(",");
      const pos = Number(parts[0]) || 0;
      const dur = Number(parts[1]) || 0;
      const reason = (parts[2]?.trim() ?? "unknown") as EndReason;
      await unlink(posPath).catch(() => {});
      await unlink(scriptPath).catch(() => {});
      return { watchedSeconds: pos, duration: dur, endReason: reason };
    } catch {}
  }

  await unlink(scriptPath).catch(() => {});

  return { watchedSeconds: 0, duration: 0, endReason: "unknown" };
}
