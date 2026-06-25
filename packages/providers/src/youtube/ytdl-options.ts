import { toYoutubeSubtitlePreferenceTokens } from "./subtitle-language";

export type YoutubeYtdlOptionsInput = {
  readonly cookiesFromBrowser?: string;
  readonly cookiesFile?: string;
  readonly extractorArgs?: string;
  readonly sponsorblockRemove?: string;
  readonly isLive?: boolean;
  readonly subtitleLanguage?: string;
};

/** Build yt-dlp CLI args shared by metadata extract, download, and mpv raw-options. */
export function buildYoutubeYtdlCliArgs(options: YoutubeYtdlOptionsInput): string[] {
  const args: string[] = [];
  if (options.cookiesFromBrowser?.trim()) {
    args.push("--cookies-from-browser", options.cookiesFromBrowser.trim());
  }
  if (options.cookiesFile?.trim()) {
    args.push("--cookies", options.cookiesFile.trim());
  }
  if (options.extractorArgs?.trim()) {
    args.push("--extractor-args", options.extractorArgs.trim());
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
  if (options.extractorArgs?.trim()) {
    raw.push(formatMpvKeyValueOption("extractor-args", options.extractorArgs.trim()));
  }
  if (options.sponsorblockRemove?.trim()) {
    raw.push(formatMpvKeyValueOption("sponsorblock-remove", options.sponsorblockRemove.trim()));
  }
  if (options.isLive) {
    raw.push("live-from-start=no");
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
