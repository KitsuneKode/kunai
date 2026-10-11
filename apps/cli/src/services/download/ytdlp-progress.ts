/**
 * Parse one yt-dlp `[download]` progress line.
 *
 * Format (varies by extractor): `[download]  34.5% of ~1.21GiB at  5.43MiB/s ETA 00:23`
 * — the size gains a `~` when it is only estimated, becomes `Unknown size`
 * when the server hides it, and the `at … ETA …` tail disappears entirely when
 * the transfer has not started producing numbers. Every field after the
 * percent is therefore optional.
 */
export type YtDlpProgress = {
  readonly percent: number;
  readonly sizeLabel?: string;
  readonly speedLabel?: string;
  readonly etaLabel?: string;
};

export function parseYtDlpProgressLine(line: string): YtDlpProgress | null {
  const match = line.match(/\[download\]\s+([\d.]+)%/);
  if (!match || !match[1]) return null;
  const percent = Number.parseFloat(match[1]);
  if (!Number.isFinite(percent)) return null;

  const sizeMatch = line.match(/\bof\s+~?(\S+(?:\s?[GMK]i?B|\s?bytes?))/i);
  const speedMatch = line.match(/\bat\s+~?(\S+\/s)\b/);
  const etaMatch = line.match(/\bETA\s+([\d:]+)/);

  return {
    percent,
    sizeLabel: sizeMatch?.[1]?.trim(),
    speedLabel: speedMatch?.[1]?.trim(),
    etaLabel: etaMatch?.[1]?.trim(),
  };
}
