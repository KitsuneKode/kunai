import type { CoreProviderModule } from "@kunai/core";
import type { ProviderResolveInput, ProviderRuntimeContext } from "@kunai/types";
import {
  httpStatusIsRetryable,
  httpStatusToResolveErrorCode,
  ProviderHttpError,
} from "@kunai/types";

import { providerFetch } from "../runtime/fetch";
import { directStreamFetchSignal } from "../shared/direct-stream-source";
import {
  masterVariantsNeedSeparateAudio,
  parseHlsMasterMaxHeight,
  parseHlsMasterRenditions,
  parseHlsMasterVariants,
} from "../shared/hls-ladder";
import { readJsonObjectBody } from "../shared/json-body";
import {
  resolveMultiSourceProvider,
  type MultiSourceResolvePayload,
  type MultiSourceSubtitleInput,
} from "../shared/multi-source-resolver";
import { FILESUN_PROVIDER_ID, filesunManifest } from "./manifest";

export { FILESUN_PROVIDER_ID };

const LOOKUP = "https://pal.hls.lol/fs/embed";
const EMBED_ORIGIN = "https://embedsun.cc";
const PLAYBACK_HEADERS = { Referer: `${EMBED_ORIGIN}/` };

interface FileSunLookup {
  readonly found?: boolean;
  readonly embeds?: readonly { readonly name?: string; readonly url?: string }[];
}

function httpsUrl(raw: string | undefined): URL | undefined {
  if (!raw || !URL.canParse(raw)) return undefined;
  const url = new URL(raw);
  return url.protocol === "https:" && !url.username && !url.password && !url.port ? url : undefined;
}

function lookupUrl(input: ProviderResolveInput): string | undefined {
  const title = input.title.title.trim();
  const year = input.title.year;
  if (!title || !year || !/^\d{4}$/.test(String(year))) return undefined;
  const tv = input.mediaKind === "series";
  const params = new URLSearchParams({
    title,
    year: String(year),
    type: tv ? "tv" : "movie",
  });
  if (tv) {
    const season = input.episode?.season;
    const episode = input.episode?.episode;
    if (
      !season ||
      !episode ||
      !Number.isSafeInteger(season) ||
      !Number.isSafeInteger(episode) ||
      season < 1 ||
      episode < 1
    ) {
      return undefined;
    }
    params.set("seasonId", String(season));
    params.set("episodeId", String(episode));
  }
  return `${LOOKUP}?${params}`;
}

async function get(
  context: ProviderRuntimeContext,
  url: string,
  headers: Record<string, string>,
  stage: string,
): Promise<Response> {
  const response = await providerFetch(context, url, {
    headers,
    signal: directStreamFetchSignal(context.signal, 8_000),
    redirect: "error",
  });
  if (!response.ok) {
    const status = response.status;
    await response.body?.cancel().catch(() => undefined);
    throw new ProviderHttpError({
      providerId: FILESUN_PROVIDER_ID,
      stage,
      status,
      message: `FileSuN ${stage} returned HTTP ${status}`,
      code: httpStatusToResolveErrorCode(status),
      retryable: httpStatusIsRetryable(status),
    });
  }
  return response;
}

function captions(html: string): MultiSourceSubtitleInput[] {
  const block = /\bvar\s+baseTracks\s*=\s*\[([\s\S]*?)\];/.exec(html)?.[1];
  if (!block) return [];
  return [...block.matchAll(/\{([^{}]+)\}/g)].flatMap(([, track]) => {
    if (!track || !/\bkind\s*:\s*['"]captions['"]/.test(track)) return [];
    const url = httpsUrl(/\bfile\s*:\s*['"]([^'"]+)['"]/.exec(track)?.[1]);
    if (!url || url.hostname !== "srt.vidmoly.me" || !/\.(?:vtt|srt|ass)$/i.test(url.pathname)) {
      return [];
    }
    const label = /\blabel\s*:\s*['"]([^'"]+)['"]/.exec(track)?.[1];
    return [{ sourceKey: "filesun", url: url.href, label }];
  });
}

async function fetchPayload(
  input: ProviderResolveInput,
  context: ProviderRuntimeContext,
): Promise<MultiSourceResolvePayload | null> {
  const path = lookupUrl(input);
  if (!path) return null;
  const lookup = await readJsonObjectBody<FileSunLookup>(
    await get(
      context,
      path,
      { Accept: "application/json", Referer: "https://atlantic.bz/" },
      "lookup",
    ),
  );
  if (lookup?.found !== true || !Array.isArray(lookup.embeds)) return null;
  const embed = httpsUrl(lookup.embeds.find((row) => row?.name === "FileSuN")?.url);
  if (
    !embed ||
    embed.origin !== EMBED_ORIGIN ||
    !/^\/embed-[a-z0-9]+\.html$/i.test(embed.pathname)
  ) {
    return null;
  }
  const html = await (
    await get(context, embed.href, { Referer: "https://atlantic.bz/" }, "embed")
  ).text();
  const url = httpsUrl(/\bsources\s*:\s*\[\s*\{\s*file\s*:\s*['"]([^'"]+)['"]/.exec(html)?.[1]);
  if (!url || !url.hostname.endsWith(".vmpx.online") || !url.pathname.endsWith(".m3u8")) {
    return null;
  }
  const master = await (await get(context, url.href, PLAYBACK_HEADERS, "manifest")).text();
  if (!master.trimStart().startsWith("#EXTM3U")) return null;
  const renditions = parseHlsMasterRenditions(master, url.href);
  const subtitles = captions(html);
  for (const track of renditions.subtitleTracks) {
    const trackUrl = httpsUrl(track.url);
    if (trackUrl && trackUrl.hostname.endsWith(".vmpx.online")) {
      subtitles.push({
        sourceKey: "filesun",
        url: trackUrl.href,
        language: track.language,
        label: track.label,
        type: "vtt",
      });
    }
  }
  const variants = masterVariantsNeedSeparateAudio(master)
    ? []
    : parseHlsMasterVariants(master, url.href).filter((variant) =>
        httpsUrl(variant.url)?.hostname.endsWith(".vmpx.online"),
      );
  const height = parseHlsMasterMaxHeight(master);
  const streams = variants.length
    ? variants.map((variant) => ({ url: variant.url, qualityHint: variant.qualityLabel }))
    : [{ url: url.href, qualityHint: height ? `${height}p` : undefined }];
  return {
    streams: streams.map((stream) => ({
      url: stream.url,
      qualityHint: stream.qualityHint,
      sourceKey: "filesun",
      sourceLabel: "FileSuN",
      protocol: "hls" as const,
      headers: PLAYBACK_HEADERS,
      audioLanguages: renditions.audioLanguages.length ? renditions.audioLanguages : undefined,
      subtitleDelivery: subtitles.length ? ("external" as const) : undefined,
    })),
    subtitles,
  };
}

export const filesunProviderModule: CoreProviderModule = {
  providerId: FILESUN_PROVIDER_ID,
  manifest: filesunManifest,
  resolve: (input, context) =>
    resolveMultiSourceProvider({
      providerId: FILESUN_PROVIDER_ID,
      label: "FileSuN",
      input,
      context,
      supportedMediaKinds: ["movie", "series"],
      unsupportedMessage: "FileSuN only supports movies and series",
      requireVerifiedStream: true,
      fetchPayload: () => fetchPayload(input, context),
    }),
};
