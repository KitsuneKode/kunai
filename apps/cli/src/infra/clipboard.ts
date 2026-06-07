// =============================================================================
// clipboard.ts — cross-platform clipboard copy/read via the host clipboard tool.
//
// macOS: pbcopy/pbpaste · Wayland: wl-copy/wl-paste · X11: xclip. Best-effort —
// returns false / null when no clipboard tool is available rather than throwing.
// =============================================================================

function copyCommand(): string[] {
  if (process.platform === "darwin") return ["pbcopy"];
  if (process.env["WAYLAND_DISPLAY"]) return ["wl-copy"];
  return ["xclip", "-selection", "clipboard"];
}

function pasteCommand(): string[] {
  if (process.platform === "darwin") return ["pbpaste"];
  if (process.env["WAYLAND_DISPLAY"]) return ["wl-paste", "--no-newline"];
  return ["xclip", "-selection", "clipboard", "-o"];
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(copyCommand(), { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
    proc.stdin.write(text);
    proc.stdin.end();
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

export async function readClipboard(): Promise<string | null> {
  try {
    const proc = Bun.spawn(pasteCommand(), { stdout: "pipe", stderr: "ignore" });
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    return proc.exitCode === 0 ? text : null;
  } catch {
    return null;
  }
}
