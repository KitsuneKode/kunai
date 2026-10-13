/**
 * Torrent readiness gate: the provider rule is "never report success for a
 * stream it has not probed" — for torrents the equivalent is "never hand mpv
 * a URL before the file head proves playable". mpv needs the container header
 * (ftyp + moov for MP4/MOV; EBML head for MKV/WebM) before it can demux, so
 * the gate waits for enough leading bytes to contain it.
 */

export type ContainerKind = "mp4" | "matroska" | "unknown";

/** MP4/MOV box scan: finds `moov` (or `mdat` proving data flow) in a prefix. */
export type Mp4BoxScan = {
  readonly hasFtyp: boolean;
  readonly moovOffset: number | null;
  readonly hasMdat: boolean;
};

export function scanMp4Boxes(prefix: Uint8Array): Mp4BoxScan {
  let hasFtyp = false;
  let moovOffset: number | null = null;
  let hasMdat = false;
  let offset = 0;
  while (offset + 8 <= prefix.length) {
    const size =
      (prefix[offset] ?? 0) * 0x1000000 +
      ((prefix[offset + 1] ?? 0) << 16) +
      ((prefix[offset + 2] ?? 0) << 8) +
      (prefix[offset + 3] ?? 0);
    const type = String.fromCharCode(
      prefix[offset + 4] ?? 0,
      prefix[offset + 5] ?? 0,
      prefix[offset + 6] ?? 0,
      prefix[offset + 7] ?? 0,
    );
    if (type === "ftyp") hasFtyp = true;
    if (type === "moov" && moovOffset === null) moovOffset = offset;
    if (type === "mdat") hasMdat = true;
    if (size < 8) break;
    if (size === 1) break;
    offset += size;
  }
  return { hasFtyp, moovOffset, hasMdat };
}

const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3] as const;

export function looksLikeMatroska(prefix: Uint8Array): boolean {
  if (prefix.length < 4) return false;
  return EBML_MAGIC.every((byte, index) => prefix[index] === byte);
}

export function classifyContainer(prefix: Uint8Array): ContainerKind {
  if (looksLikeMatroska(prefix)) return "matroska";
  const { hasFtyp } = scanMp4Boxes(prefix);
  if (hasFtyp) return "mp4";
  return "unknown";
}

export type ReadinessAssessment = {
  /** Enough leading bytes to prove the container header. */
  readonly ready: boolean;
  readonly container: ContainerKind;
  readonly headBytes: number;
  readonly reason: string;
};

/**
 * Pure readiness check over the downloaded file prefix. `headBytes` is how
 * many leading bytes are contiguously available; `totalLength` sizes the
 * evidence bar for tiny files.
 */
export function assessTorrentReadiness(
  prefix: Uint8Array,
  totalLength: number,
  options: { readonly minHeadBytes?: number } = {},
): ReadinessAssessment {
  const minHeadBytes = Math.min(options.minHeadBytes ?? 2_097_152, Math.max(totalLength, 1));
  const container = classifyContainer(prefix);
  if (container === "matroska") {
    return { ready: true, container, headBytes: prefix.length, reason: "ebml head present" };
  }
  if (container === "mp4") {
    const { moovOffset } = scanMp4Boxes(prefix);
    if (moovOffset !== null) {
      return {
        ready: true,
        container,
        headBytes: prefix.length,
        reason: `moov at offset ${moovOffset}`,
      };
    }
    // Fast-start files put moov first; others append it at the end, which a
    // partial download may never have. Without moov, mpv cannot seek — wait
    // for more head unless the file is nearly whole.
    if (prefix.length >= totalLength) {
      return { ready: true, container, headBytes: prefix.length, reason: "file complete" };
    }
    return {
      ready: false,
      container,
      headBytes: prefix.length,
      reason: `ftyp without moov in first ${prefix.length} bytes`,
    };
  }
  if (prefix.length >= minHeadBytes || prefix.length >= totalLength) {
    return {
      ready: prefix.length > 0,
      container,
      headBytes: prefix.length,
      reason: "head window complete, container unrecognized",
    };
  }
  return {
    ready: false,
    container,
    headBytes: prefix.length,
    reason: `need ${minHeadBytes} head bytes, have ${prefix.length}`,
  };
}

/** Largest playable video file wins; audio/subtitle sidecars never do. */
const VIDEO_EXTENSIONS = [".mp4", ".mkv", ".webm", ".avi", ".mov", ".m4v", ".ts"] as const;

export function isVideoFilename(name: string): boolean {
  const lower = name.toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function pickVideoFile<T extends { readonly name: string; readonly length: number }>(
  files: readonly T[],
): T | null {
  let best: T | null = null;
  for (const file of files) {
    if (!isVideoFilename(file.name)) continue;
    if (!best || file.length > best.length) best = file;
  }
  return best;
}
