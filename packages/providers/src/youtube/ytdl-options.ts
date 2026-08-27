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

/**
 * yt-dlp reads `--extractor-args` as ONE `IE_KEY:` prefix followed by `;`-separated
 * `key=value` pairs, and it strips that prefix exactly once
 * (`yt_dlp/options.py` `_dict_from_options_callback` + `_extractor_arg_parser`).
 * A second `youtube:` inside the same string therefore lands in the *key* name:
 * `youtube:player_client=web;youtube:po_token=X` parses to the key
 * `youtube:po_token`, which no extractor ever reads, so the value is silently
 * dropped. Every edit to these args goes through parse/serialize below so that
 * shape can only be produced correctly.
 */
type ExtractorArgs = {
  readonly ieKey: string;
  readonly entries: readonly (readonly [key: string, value: string])[];
};

const DEFAULT_IE_KEY = "youtube";

function parseExtractorArgs(raw: string | undefined): ExtractorArgs {
  const trimmed = raw?.trim();
  if (!trimmed) return { ieKey: DEFAULT_IE_KEY, entries: [] };
  // `[\w-]+` is yt-dlp's own `allowed_keys`; anything else is not an IE prefix.
  const colon = trimmed.indexOf(":");
  const hasIeKey = colon > 0 && /^[\w-]+$/.test(trimmed.slice(0, colon));
  const ieKey = hasIeKey ? trimmed.slice(0, colon) : DEFAULT_IE_KEY;
  const body = hasIeKey ? trimmed.slice(colon + 1) : trimmed;
  const entries: (readonly [string, string])[] = [];
  for (const segment of body.split(";")) {
    const part = segment.trim();
    if (!part) continue;
    const eq = part.indexOf("=");
    const key = (eq === -1 ? part : part.slice(0, eq)).trim().toLowerCase();
    if (!key) continue;
    entries.push([key, eq === -1 ? "" : part.slice(eq + 1).trim()]);
  }
  return { ieKey, entries };
}

function serializeExtractorArgs(args: ExtractorArgs): string {
  return `${args.ieKey}:${args.entries.map(([key, value]) => `${key}=${value}`).join(";")}`;
}

function extractorArgValue(args: ExtractorArgs, key: string): string | undefined {
  return args.entries.find(([entryKey]) => entryKey === key)?.[1];
}

function withExtractorArg(args: ExtractorArgs, key: string, value: string): ExtractorArgs {
  const replaced = args.entries.some(([entryKey]) => entryKey === key);
  return {
    ieKey: args.ieKey,
    entries: replaced
      ? args.entries.map((entry) => (entry[0] === key ? ([key, value] as const) : entry))
      : [...args.entries, [key, value] as const],
  };
}

/**
 * Attach a GVS PO token to extractor args.
 *
 * yt-dlp matches a token against the client it was issued for
 * (`_video.py` `_get_config_po_token`: `if po_token_client.lower() != client: continue`),
 * so a bare token is scoped to whichever client these args already request —
 * Kunai rewrites `player_client` to one client per failover lane before this
 * runs, so the token follows its lane instead of being pinned to `web`.
 */
export function appendYoutubePoToken(
  extractorArgs: string | undefined,
  poToken: string | undefined,
): string | undefined {
  const trimmedToken = poToken?.trim();
  const parsed = parseExtractorArgs(extractorArgs);
  const unchanged = parsed.entries.length > 0 ? serializeExtractorArgs(parsed) : undefined;
  if (!trimmedToken || extractorArgValue(parsed, "po_token") !== undefined) return unchanged;
  const client = parseYoutubePlayerClients(extractorArgs)[0] ?? "web";
  // `CLIENT.CONTEXT+TOKEN`; yt-dlp still accepts a context-less `CLIENT+TOKEN`
  // but only after a debug warning, so name the GVS context explicitly.
  const value = trimmedToken.includes("+") ? trimmedToken : `${client}.gvs+${trimmedToken}`;
  return serializeExtractorArgs(withExtractorArg(parsed, "po_token", value));
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
  const value = extractorArgValue(parseExtractorArgs(extractorArgs), "player_client");
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(",")
        .map((client) => client.trim())
        .filter(Boolean),
    ),
  ];
}

/** Rewrite extractor args to request exactly one player client, preserving other keys. */
export function withYoutubePlayerClient(extractorArgs: string | undefined, client: string): string {
  return serializeExtractorArgs(
    withExtractorArg(parseExtractorArgs(extractorArgs), "player_client", client),
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
