export type YoutubeYtdlOptionsInput = {
  readonly cookiesFromBrowser?: string;
  readonly cookiesFile?: string;
  readonly extractorArgs?: string;
  readonly sponsorblockRemove?: string;
  readonly isLive?: boolean;
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
  return raw;
}

export function joinMpvYtdlRawOptions(options: readonly string[]): string | undefined {
  if (options.length === 0) return undefined;
  return options.join(",");
}

function formatMpvKeyValueOption(key: string, value: string): string {
  return `${key}=${quoteMpvSuboptionValue(value)}`;
}

function quoteMpvSuboptionValue(value: string): string {
  const encodedLength = new TextEncoder().encode(value).length;
  return `%${encodedLength}%${value}`;
}
