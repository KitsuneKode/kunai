import type { ResolveErrorCode } from "@kunai/types";

/**
 * What a failed `yt-dlp` metadata probe actually means.
 *
 * Every failure used to collapse into one retryable `parse-failed`, and resolve
 * carried on to return `status: "resolved"` with the bare watch URL. A private,
 * deleted, members-only, age-gated or geo-blocked video therefore looked like a
 * success: nothing fell back, and playback died inside mpv with no diagnosis
 * anywhere near the cause.
 *
 * The split that matters is **terminal vs transient**, not the exact reason:
 *
 * - **Terminal** — yt-dlp reached YouTube and was told no. Playback would fail
 *   the same way, so resolve fails closed with the real reason and the engine
 *   moves on immediately.
 * - **Transient** — the probe itself failed (network, throttling, timeout). The
 *   video may well play, so resolve continues without metadata rather than
 *   destroying a working path over a flaky probe.
 *
 * Matching is on yt-dlp's stderr, which `fetchYtDlpVideoInfo` throws verbatim.
 */
export type YoutubeMetadataFailure = {
  readonly code: ResolveErrorCode;
  readonly message: string;
  /** Terminal failures stop the lane; transient ones degrade it. */
  readonly terminal: boolean;
};

type Rule = {
  readonly code: ResolveErrorCode;
  readonly terminal: boolean;
  readonly message: string;
  readonly patterns: readonly RegExp[];
};

const RULES: readonly Rule[] = [
  {
    code: "not-found",
    terminal: true,
    message: "This YouTube video is private",
    patterns: [/private video/i, /sign in if you'?ve been granted access/i],
  },
  {
    code: "blocked",
    terminal: true,
    message: "This YouTube video is members-only",
    patterns: [
      /members[- ]only/i,
      /join this channel to get access/i,
      /available to this channel'?s members/i,
    ],
  },
  {
    code: "blocked",
    terminal: true,
    message: "This YouTube video is age-restricted and needs a signed-in account",
    patterns: [
      /sign in to confirm your age/i,
      /age[- ]restricted/i,
      /inappropriate for some users/i,
    ],
  },
  {
    code: "blocked",
    terminal: true,
    message:
      "YouTube is asking Kunai to prove it is not a bot — try again later or configure cookies",
    patterns: [/confirm you'?re not a bot/i, /not a bot/i],
  },
  {
    code: "blocked",
    terminal: true,
    message: "This YouTube video is not available in your country",
    patterns: [
      /not made this video available in your country/i,
      /not available in your country/i,
      /blocked it in your country/i,
      /who has blocked it on copyright grounds/i,
    ],
  },
  // Generic last: yt-dlp prefixes several specific refusals with "Video
  // unavailable", so the precise rules above must get first refusal.
  {
    code: "not-found",
    terminal: true,
    message: "This YouTube video has been removed or is unavailable",
    patterns: [
      /removed by the uploader/i,
      /video (?:has been|was) removed/i,
      /no longer available/i,
      /video unavailable/i,
      /account associated with this video has been terminated/i,
    ],
  },
  {
    code: "rate-limited",
    terminal: false,
    message: "YouTube is rate-limiting metadata requests",
    patterns: [/http error 429/i, /too many requests/i],
  },
  {
    code: "timeout",
    terminal: false,
    message: "yt-dlp metadata timed out",
    patterns: [/timed out/i, /timeout/i],
  },
  {
    code: "network-error",
    terminal: false,
    message: "Could not reach YouTube for metadata",
    patterns: [
      /unable to download (?:webpage|api page)/i,
      /connection (?:refused|reset|aborted)/i,
      /temporary failure in name resolution/i,
      /getaddrinfo/i,
      /http error 5\d\d/i,
    ],
  },
];

export function classifyYoutubeMetadataFailure(error: unknown): YoutubeMetadataFailure {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const text = raw.trim();

  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      return { code: rule.code, message: rule.message, terminal: rule.terminal };
    }
  }

  // Unknown failures stay transient on purpose: guessing "terminal" would turn a
  // yt-dlp quirk into an unplayable video.
  return {
    code: "parse-failed",
    message:
      text.length > 0 ? `yt-dlp metadata failed: ${firstLine(text)}` : "yt-dlp metadata failed",
    terminal: false,
  };
}

function firstLine(text: string): string {
  const line = text.split("\n").find((entry) => entry.trim().length > 0) ?? text;
  return line.replace(/^error:\s*/i, "").trim();
}
