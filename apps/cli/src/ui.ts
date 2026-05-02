import { log } from "@clack/prompts";

// ── Dependency check ───────────────────────────────────────────────────────

type DepStatus = { mpv: boolean };

async function which(cmd: string): Promise<boolean> {
  return Boolean(Bun.which(cmd));
}

export async function checkDeps(): Promise<DepStatus> {
  const mpv = await which("mpv");

  if (!mpv) {
    log.error("mpv not found — required for playback.");
    log.message(
      "Install:\n" +
        "  Arch:   sudo pacman -S mpv\n" +
        "  Debian: sudo apt install mpv\n" +
        "  macOS:  brew install mpv",
    );
    process.exit(1);
  }

  return { mpv };
}
