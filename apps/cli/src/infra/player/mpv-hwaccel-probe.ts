import { detectImageCapability, type ImageCapability } from "@/image";

import { discoverMpvInvocation } from "./mpv-discovery";

/** Hardware decoder backends we surface in doctor/setup copy. */
export const MPV_GPU_HW_DECODER_IDS = ["vaapi", "nvdec", "videotoolbox", "d3d11va"] as const;

export type MpvGpuHwDecoderId = (typeof MPV_GPU_HW_DECODER_IDS)[number];

export type MpvHardwareAccelProbe = {
  /** Raw stdout/stderr from `mpv --hwdec=help` (may be empty if mpv missing). */
  readonly hwdecHelp: string;
  /** Subset of GPU-oriented backends mentioned in the help output. */
  readonly drivers: readonly MpvGpuHwDecoderId[];
  /** Whether `mpv ... --hwdec=auto-safe` exited 0 on a minimal null render. */
  readonly autoSafeOk: boolean;
  /**
   * When `autoSafeOk`, best-effort primary backend name parsed from mpv stderr
   * (e.g. `vaapi`, `nvdec`). Empty when we could not classify.
   */
  readonly autoSafeDriver: string;
  /** Human-readable terminal graphics path (Kitty protocol, Sixel, half-block, …). */
  readonly terminalGraphics: string;
};

export function terminalGraphicsLabel(image: ImageCapability): string {
  const r = image.renderer;
  if (r === "kitty-native") return "Kitty";
  if (r === "sixel") return "Sixel";
  if (r === "half-block") return "half-block";
  if (r === "iterm-inline") return "iTerm inline";
  if (r === "none") {
    return image.terminal && image.terminal !== "unknown"
      ? `${image.terminal} (no graphics)`
      : "none";
  }
  return r;
}

/** Probe fields when mpv is absent or we skip spawning (tests). */
export function emptyMpvHardwareAccelProbe(image: ImageCapability): MpvHardwareAccelProbe {
  return {
    hwdecHelp: "",
    drivers: [],
    autoSafeOk: false,
    autoSafeDriver: "",
    terminalGraphics: terminalGraphicsLabel(image),
  };
}

function parseGpuDriversFromHwdecHelp(text: string): MpvGpuHwDecoderId[] {
  const lower = text.toLowerCase();
  const found: MpvGpuHwDecoderId[] = [];
  for (const id of MPV_GPU_HW_DECODER_IDS) {
    if (lower.includes(id)) found.push(id);
  }
  return found;
}

/**
 * Best-effort: mpv often prints lines like "Using hardware decoding (vaapi-copy)."
 */
function parseAutoSafeDriver(stderr: string): string {
  const m = /hardware decoding\s*\(([^)]+)\)/i.exec(stderr);
  if (!m?.[1]) return "";
  const inner = m[1].trim().toLowerCase();
  const token = inner.split(/[-\s]/)[0] ?? "";
  if (MPV_GPU_HW_DECODER_IDS.some((id) => token.startsWith(id) || inner.includes(id))) {
    return token.replace(/copy$/, "").replace(/-copy$/, "");
  }
  return token;
}

export type MpvSyncSpawnResult = {
  readonly exitCode: number | null;
  readonly stdout?: Uint8Array | undefined;
  readonly stderr?: Uint8Array | undefined;
};

export type MpvSyncSpawnFn = (options: {
  cmd: string[];
  stdout?: "pipe" | "ignore";
  stderr?: "pipe" | "ignore";
  timeout?: number;
}) => MpvSyncSpawnResult;

const defaultSpawnSync: MpvSyncSpawnFn = (options) => Bun.spawnSync(options);

export type MpvHwaccelProbeDeps = {
  readonly which?: (command: string) => string | null;
  readonly exists?: (path: string) => boolean;
  readonly platform?: NodeJS.Platform;
  readonly detectImageCapability?: () => ImageCapability;
  readonly spawnSync?: MpvSyncSpawnFn;
};

function decodeSyncOutput(chunk: Uint8Array | undefined): string {
  if (!chunk || chunk.length === 0) return "";
  return new TextDecoder().decode(chunk);
}

export function probeMpvHardwareAcceleration(
  deps: MpvHwaccelProbeDeps = {},
): MpvHardwareAccelProbe {
  const spawnSync = deps.spawnSync ?? defaultSpawnSync;
  const detect = deps.detectImageCapability ?? detectImageCapability;
  const image = detect();

  const invocation = discoverMpvInvocation({
    which: deps.which,
    exists: deps.exists,
    platform: deps.platform,
  });
  if (!invocation) {
    return emptyMpvHardwareAccelProbe(image);
  }

  const helpProc = spawnSync({
    cmd: [...invocation.argv, "--no-config", "--hwdec=help"],
    stdout: "pipe",
    stderr: "pipe",
    timeout: 8_000,
  });
  const helpOut = [decodeSyncOutput(helpProc.stdout), decodeSyncOutput(helpProc.stderr)]
    .filter(Boolean)
    .join("\n");
  const drivers = parseGpuDriversFromHwdecHelp(helpOut);

  // One frame through null video output — enough for mpv to initialize hwdec without a window.
  const autoSafe = spawnSync({
    cmd: [
      ...invocation.argv,
      "--no-config",
      "--no-terminal",
      "--vo=null",
      "--ao=null",
      "--hwdec=auto-safe",
      "--frames=1",
      "lavfi://color=black:s=2x2",
    ],
    stdout: "ignore",
    stderr: "pipe",
    timeout: 3_000,
  });
  const errText = decodeSyncOutput(autoSafe.stderr);
  const autoSafeOk = autoSafe.exitCode === 0;
  const autoSafeDriver = autoSafeOk ? parseAutoSafeDriver(errText) : "";

  return {
    hwdecHelp: helpOut.trim(),
    drivers,
    autoSafeOk,
    autoSafeDriver,
    terminalGraphics: terminalGraphicsLabel(image),
  };
}
