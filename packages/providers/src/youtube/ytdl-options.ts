import { toYoutubeSubtitlePreferenceTokens } from "./subtitle-language";

export type YoutubeYtdlOptionsInput = {
  readonly cookiesFromBrowser?: string;
  readonly cookiesFile?: string;
  readonly extractorArgs?: string;
  readonly poToken?: string;
  readonly sponsorblockRemove?: string;
  readonly isLive?: boolean;
  readonly subtitleLanguage?: string;
};

const PLAYER_CLIENT_PATTERN = /(^|;)\s*youtube:([^;]*\b)?player_client=([^;]*)/i;

/** Append a PO token to yt-dlp extractor args if not already present. */
export function appendYoutubePoToken(
  extractorArgs: string | undefined,
  poToken: string | undefined,
): string | undefined {
  const trimmedToken = poToken?.trim();
  if (!trimmedToken) return extractorArgs?.trim() || undefined;
  const tokenVal = trimmedToken.includes("+") ? trimmedToken : `web+${trimmedToken}`;
  const trimmedArgs = extractorArgs?.trim();
  if (!trimmedArgs) return `youtube:po_token=${tokenVal}`;
  if (/youtube:[^;]*\bpo_token=/i.test(trimmedArgs)) return trimmedArgs;
  return `${trimmedArgs};youtube:po_token=${tokenVal}`;
}

/**
 * The player clients an extractor-args string asks for, in order.
 *
 * Each client is a separate way of asking YouTube for the same video, and they
 * fail independently — one 403s on media URLs while another plays. Naming them
 * individually is what lets playback fail over between them instead of dying on
 * whichever one yt-dlp happened to pick.
 */
export function parseYoutubePlayerClients(extractorArgs: string | undefined): readonly string[] {
  const match = extractorArgs?.match(PLAYER_CLIENT_PATTERN);
  if (!match?.[3]) return [];
  return [
    ...new Set(
      match[3]
        .split(",")
        .map((client) => client.trim())
        .filter(Boolean),
    ),
  ];
}

/** Rewrite extractor args to request exactly one player client, preserving other keys. */
export function withYoutubePlayerClient(extractorArgs: string | undefined, client: string): string {
  const trimmed = extractorArgs?.trim();
  if (!trimmed) return `youtube:player_client=${client}`;
  if (!PLAYER_CLIENT_PATTERN.test(trimmed)) {
    return `${trimmed};youtube:player_client=${client}`;
  }
  return trimmed.replace(
    PLAYER_CLIENT_PATTERN,
    (_full, lead: string, prefix: string | undefined) =>
      `${lead}youtube:${prefix ?? ""}player_client=${client}`,
  );
}

/** Build yt-dlp CLI args shared by metadata extract, download, and mpv raw-options. */
export function buildYoutubeYtdlCliArgs(options: YoutubeYtdlOptionsInput): string[] {
  const args: string[] = [];
  if (options.cookiesFromBrowser?.trim()) {
    args.push("--cookies-from-browser", options.cookiesFromBrowser.trim());
  }
  if (options.cookiesFile?.trim()) {
    args.push("--cookies", options.cookiesFile.trim());
  }
  const extractorArgs = appendYoutubePoToken(options.extractorArgs, options.poToken);
  if (extractorArgs?.trim()) {
    args.push("--extractor-args", extractorArgs.trim());
  }
  if (options.sponsorblockRemove?.trim()) {
    args.push("--sponsorblock-remove", options.sponsorblockRemove.trim());
  }
  if (options.isLive) {
    args.push("--no-live-from-start");
  }
  const subLangs = toYoutubeSubtitlePreferenceTokens(options.subtitleLanguage).ytdlpSubLangs;
  if (subLangs) {
    args.push("--sub-langs", subLangs);
  }
  return args;
}

/** mpv --ytdl-raw-options values (comma-separated key=value pairs per flag). */
export function buildYoutubeMpvYtdlRawOptions(options: YoutubeYtdlOptionsInput): readonly string[] {
  const raw: string[] = [];
  if (options.cookiesFromBrowser?.trim()) {
    raw.push(formatMpvKeyValueOption("cookies-from-browser", options.cookiesFromBrowser.trim()));
  }
  if (options.cookiesFile?.trim()) {
    raw.push(formatMpvKeyValueOption("cookies", options.cookiesFile.trim()));
  }
  const extractorArgs = appendYoutubePoToken(options.extractorArgs, options.poToken);
  if (extractorArgs?.trim()) {
    raw.push(formatMpvKeyValueOption("extractor-args", extractorArgs.trim()));
  }
  if (options.sponsorblockRemove?.trim()) {
    raw.push(formatMpvKeyValueOption("sponsorblock-remove", options.sponsorblockRemove.trim()));
  }
  if (options.isLive) {
    raw.push("no-live-from-start=");
  }
  const subLangs = toYoutubeSubtitlePreferenceTokens(options.subtitleLanguage).ytdlpSubLangs;
  if (subLangs) {
    raw.push(formatMpvKeyValueOption("sub-langs", subLangs));
  }
  return raw;
}

export function joinMpvYtdlRawOptions(options: readonly string[]): string | undefined {
  if (options.length === 0) return undefined;
  return options.join(",");
}

/**
 * mpv script-opts that stop mpv-ytdlautoformat from overriding Kunai's ytdl-format.
 * @see https://github.com/Samillion/mpv-ytdlautoformat
 */
export function buildYoutubeMpvScriptOpts(): string {
  return "ytdlautoformat-domains=";
}

export function joinMpvScriptOpts(...parts: readonly (string | undefined)[]): string | undefined {
  const merged = parts
    .flatMap((part) => part?.split(",") ?? [])
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (merged.length === 0) return undefined;
  return merged.join(",");
}

function formatMpvKeyValueOption(key: string, value: string): string {
  return `${key}=${quoteMpvSuboptionValue(value)}`;
}

function quoteMpvSuboptionValue(value: string): string {
  const encodedLength = new TextEncoder().encode(value).length;
  return `%${encodedLength}%${value}`;
}
