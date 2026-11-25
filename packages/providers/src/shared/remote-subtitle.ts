import { fetchGuardedStreamTarget, type StreamReachabilityFetch } from "@kunai/core";

import { readBoundedTextBody } from "./bounded-text-body";
import { createTimeoutSignal } from "./timeout-signal";

/** A subtitle file that passed the guarded download and format check. */
export interface RemoteSubtitleFile {
  readonly text: string;
  /** Extension derived from the verified body, never from the URL. */
  readonly extension: "srt" | "vtt" | "ass";
}

const SUBTITLE_BODY_BYTES = 512 * 1024;
const SUBTITLE_TIMEOUT_MS = 3_000;
const WEBVTT_BODY = /^WEBVTT(?:[ \t]|\r?\n|$)/;
// An SRT opens (after blank lines) with a cue counter then a timestamp line.
const SRT_BODY =
  /^(?:[ \t]*\r?\n)*[ \t]*\d+[ \t]*\r?\n\d{2}:\d{2}:\d{2}[,.]\d{3}[ \t]+-->[ \t]+\d{2}:\d{2}:\d{2}[,.]\d{3}/;
const ASS_BODY = /^\uFEFF?\[Script Info\]/;

function subtitleExtensionFor(text: string): RemoteSubtitleFile["extension"] | null {
  const unbombed = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (WEBVTT_BODY.test(unbombed)) return "vtt";
  if (SRT_BODY.test(unbombed)) return "srt";
  // ASS needs the script-info header plus an events section with dialogue;
  // a stray [Script Info] line alone is not a playable track.
  if (
    ASS_BODY.test(unbombed) &&
    /^\s*\[Events\]\s*$/m.test(unbombed) &&
    /^Dialogue:/m.test(unbombed)
  )
    return "ass";
  return null;
}

export interface SubtitleMediaRequest {
  readonly url: string;
  readonly headers?: Record<string, string>;
}

function subtitleHeaders(url: string, media?: SubtitleMediaRequest): Headers | undefined {
  if (!media?.headers) return undefined;
  const mediaOrigin = URL.parse(media.url)?.origin;
  const subtitleOrigin = URL.parse(url)?.origin;
  if (mediaOrigin && mediaOrigin === subtitleOrigin) return new Headers(media.headers);

  // KickAssAnime serves captions on a separate, known origin. Only the
  // player Origin header is needed there; media cookies and other fields stay scoped.
  if (
    (mediaOrigin === "https://hls.krussdomi.com" || mediaOrigin === "https://bl.krussdomi.com") &&
    subtitleOrigin === "https://subst.krussdomi.com"
  ) {
    const origin = new Headers(media.headers).get("origin");
    if (origin) return new Headers({ origin });
  }
  return undefined;
}

/** Fetch an external subtitle through the shared pinned transport and validate its body. */
export async function fetchRemoteSubtitle(
  url: string,
  options: {
    readonly signal?: AbortSignal;
    readonly media?: SubtitleMediaRequest;
    readonly fetchImpl?: StreamReachabilityFetch;
    readonly resolveAddresses?: (host: string) => Promise<readonly string[]>;
  } = {},
): Promise<RemoteSubtitleFile | null> {
  const signal = createTimeoutSignal(options.signal, SUBTITLE_TIMEOUT_MS);
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const outcome = await fetchGuardedStreamTarget({
      fetchImpl,
      url,
      init: { method: "GET", headers: subtitleHeaders(url, options.media) },
      signal,
      resolveAddresses: options.resolveAddresses,
      omitCrossOriginHeaders: true,
    });
    if (outcome.kind !== "response") return null;
    const response = outcome.response;
    if (!response.ok || signal.aborted) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (declaredLength > SUBTITLE_BODY_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const text = await readBoundedTextBody(response.body, SUBTITLE_BODY_BYTES, signal);
    if (!text || signal.aborted || text.includes("\0")) return null;
    const extension = subtitleExtensionFor(text);
    if (!extension) return null;
    return { text, extension };
  } catch {
    return null;
  }
}
