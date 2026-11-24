/**
 * The real players and tools native integration tests drive, looked up once.
 *
 * A native test decides run-or-skip at module load, so these are read when the
 * module loads: in one place, instead of a copy per test file. CI installs mpv
 * and ffmpeg on Linux and macOS; VLC runs where it is installed.
 */
export const NATIVE_BINARIES = {
  mpv: Bun.which("mpv"),
  ffmpeg: Bun.which("ffmpeg"),
  vlc: Bun.which("vlc"),
} as const;
