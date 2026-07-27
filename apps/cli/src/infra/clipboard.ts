// =============================================================================
// clipboard.ts — cross-platform clipboard copy/read via the host clipboard tool.
//
// macOS: pbcopy/pbpaste · Wayland: wl-copy/wl-paste · X11: xclip · Windows:
// PowerShell's Set-Clipboard/Get-Clipboard. Best-effort — returns false / null
// when no clipboard tool is available rather than throwing.
// =============================================================================

type ClipboardSpawnOptions = {
  readonly stdin?: "pipe";
  readonly stdout?: "pipe" | "ignore";
  readonly stderr?: "ignore";
};

type ClipboardProcess = {
  readonly exited: Promise<number>;
  readonly stdin?: {
    write(data: string): void;
    end(): void;
  };
  readonly stdout?: ReadableStream<Uint8Array> | null;
};

/** Injectable process boundary for deterministic platform clipboard contracts. */
export type ClipboardRuntime = {
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
  readonly spawn: (command: readonly string[], options: ClipboardSpawnOptions) => ClipboardProcess;
};

export const defaultClipboardRuntime: ClipboardRuntime = {
  platform: process.platform,
  env: process.env,
  spawn: (command, options) => Bun.spawn([...command], options) as unknown as ClipboardProcess,
};

function copyCommand(runtime: ClipboardRuntime): string[] {
  if (runtime.platform === "win32") {
    return [
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "[Console]::InputEncoding = [Text.UTF8Encoding]::new($false); Set-Clipboard -Value ([Console]::In.ReadToEnd())",
    ];
  }
  if (runtime.platform === "darwin") return ["pbcopy"];
  if (runtime.env["WAYLAND_DISPLAY"]) return ["wl-copy"];
  return ["xclip", "-selection", "clipboard"];
}

function pasteCommand(runtime: ClipboardRuntime): string[] {
  if (runtime.platform === "win32") {
    return [
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); [Console]::Out.Write((Get-Clipboard -Raw))",
    ];
  }
  if (runtime.platform === "darwin") return ["pbpaste"];
  if (runtime.env["WAYLAND_DISPLAY"]) return ["wl-paste", "--no-newline"];
  return ["xclip", "-selection", "clipboard", "-o"];
}

export async function copyToClipboard(
  text: string,
  runtime: ClipboardRuntime = defaultClipboardRuntime,
): Promise<boolean> {
  try {
    const proc = runtime.spawn(copyCommand(runtime), {
      stdin: "pipe",
      stdout: "ignore",
      stderr: "ignore",
    });
    if (!proc.stdin) return false;
    proc.stdin.write(text);
    proc.stdin.end();
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

export async function readClipboard(
  runtime: ClipboardRuntime = defaultClipboardRuntime,
): Promise<string | null> {
  try {
    const proc = runtime.spawn(pasteCommand(runtime), { stdout: "pipe", stderr: "ignore" });
    if (!proc.stdout) return null;
    const text = await new Response(proc.stdout).text();
    return (await proc.exited) === 0 ? text : null;
  } catch {
    return null;
  }
}
