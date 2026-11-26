/**
 * The real players and tools native integration tests drive.
 *
 * A native test decides run-or-skip when its module loads; resolving through
 * this function keeps the PATH lookup in one place instead of a copy per test
 * file. CI installs mpv and ffmpeg on Linux and macOS; VLC runs where it is
 * installed.
 */
export function nativeBinary(name: "mpv" | "ffmpeg" | "vlc"): string | null {
  return Bun.which(name);
}
