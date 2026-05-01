import { readFile } from "node:fs/promises";

import * as loader from "@assemblyscript/loader";
import CryptoJS from "crypto-js";

import type {
  EpisodeInfo,
  StreamInfo,
  SubtitleEvidence,
  SubtitleTrack,
  TitleInfo,
} from "@/domain/types";
import { selectSubtitle } from "@/subtitle";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const VIDKING_REFERER = "https://www.vidking.net/";
const VIDKING_ORIGIN = "https://www.vidking.net";
const VIDKING_API_BASE = "https://api.videasy.net";
const VIDKING_SERVERS = ["mb-flix", "cdn", "downloader2", "1movies"] as const;

type VidkingSource = {
  url?: string;
  quality?: string;
};

type VidkingSubtitle = {
  url?: string;
  src?: string;
  file?: string;
  href?: string;
  lang?: string;
  language?: string;
  label?: string;
  release?: string;
};

type VidkingPayload = {
  sources?: VidkingSource[];
  subtitles?: VidkingSubtitle[];
};

type WasmExports = {
  __newString(value: string): number;
  __getString(pointer: number): string;
  decrypt(payloadPointer: number, tmdbId: number): number;
};

let wasmExportsPromise: Promise<WasmExports> | null = null;

export async function resolveVidkingDirect(opts: {
  title: TitleInfo;
  episode?: EpisodeInfo;
  preferredSubLang: string;
  signal?: AbortSignal;
}): Promise<StreamInfo | null> {
  const mediaType = opts.title.type === "series" ? "tv" : "movie";
  const tmdbId = Number.parseInt(opts.title.id, 10);
  if (!Number.isFinite(tmdbId)) {
    return null;
  }

  for (const endpoint of VIDKING_SERVERS) {
    for (const query of buildQueryVariants({
      title: opts.title,
      mediaType,
      tmdbId,
      episode: opts.episode,
    })) {
      try {
        const res = await fetch(
          `${VIDKING_API_BASE}/${endpoint}/sources-with-title?${query.toString()}`,
          {
            signal: opts.signal ?? AbortSignal.timeout(12_000),
            headers: {
              accept: "*/*",
              "accept-language": "en-US,en;q=0.9",
              origin: VIDKING_ORIGIN,
              referer: VIDKING_REFERER,
              "user-agent": USER_AGENT,
            },
          },
        );

        if (!res.ok) {
          continue;
        }

        const payload = (await res.text()).trim();
        if (!payload) {
          continue;
        }

        const decoded = await decodeVidkingPayload(payload, tmdbId);
        const bestSource = pickBestSource(decoded.sources);
        if (!bestSource?.url) {
          continue;
        }

        const subtitleList = normalizeSubtitleList(decoded.subtitles);
        const picked = pickSubtitleTrack(subtitleList, opts.preferredSubLang);
        const subtitleEvidence: SubtitleEvidence = subtitleList.length
          ? {
              directSubtitleObserved: true,
              wyzieSearchObserved: false,
              reason: "provider-default",
            }
          : {
              directSubtitleObserved: false,
              wyzieSearchObserved: false,
              reason: "not-observed",
            };

        return {
          url: bestSource.url,
          headers: {
            referer: VIDKING_REFERER,
            origin: VIDKING_ORIGIN,
            "user-agent": USER_AGENT,
          },
          subtitle: picked?.url,
          subtitleList,
          subtitleSource: subtitleList.length > 0 ? "provider" : "none",
          subtitleEvidence,
          title: opts.title.name,
          timestamp: Date.now(),
        };
      } catch {
        continue;
      }
    }
  }

  return null;
}

async function loadWasmExports(): Promise<WasmExports> {
  if (wasmExportsPromise) {
    return wasmExportsPromise;
  }

  wasmExportsPromise = (async () => {
    const wasmBuffer = await readFile(new URL("./assets/module1_patched.wasm", import.meta.url));
    const module = await loader.instantiate(wasmBuffer, {
      env: {
        seed: () => Date.now(),
        abort: () => {},
      },
    });

    return module.exports as unknown as WasmExports;
  })();

  return await wasmExportsPromise;
}

async function decodeVidkingPayload(payload: string, tmdbId: number): Promise<VidkingPayload> {
  const wasm = await loadWasmExports();
  const payloadPtr = wasm.__newString(payload);
  const decryptedPtr = wasm.decrypt(payloadPtr, tmdbId);
  const wasmDecryptedBase64 = wasm.__getString(decryptedPtr);
  const decryptedBytes = CryptoJS.AES.decrypt(wasmDecryptedBase64, "");
  const finalJson = decryptedBytes.toString(CryptoJS.enc.Utf8);
  return JSON.parse(finalJson) as VidkingPayload;
}

function pickBestSource(sources: VidkingSource[] | undefined): VidkingSource | null {
  if (!sources?.length) {
    return null;
  }

  return [...sources].sort((left, right) => scoreSource(right) - scoreSource(left))[0] ?? null;
}

function scoreSource(source: VidkingSource): number {
  const quality = source.quality ?? "";
  const numeric = Number.parseInt(quality, 10);
  return Number.isFinite(numeric) ? numeric : 0;
}

function buildQueryVariants(opts: {
  title: TitleInfo;
  mediaType: "movie" | "tv";
  tmdbId: number;
  episode?: EpisodeInfo;
}): URLSearchParams[] {
  const variants: URLSearchParams[] = [];

  const base = new URLSearchParams({
    title: opts.title.name,
    mediaType: opts.mediaType,
    tmdbId: String(opts.tmdbId),
  });

  if (opts.title.type === "series") {
    if (!opts.episode) {
      return [];
    }
    base.set("seasonId", String(opts.episode.season));
    base.set("episodeId", String(opts.episode.episode));
  }

  if (opts.title.year) {
    const withYear = new URLSearchParams(base);
    withYear.set("year", opts.title.year);
    variants.push(withYear);
  }

  variants.push(base);
  return variants;
}

function normalizeSubtitleList(subtitles: VidkingSubtitle[] | undefined): SubtitleTrack[] {
  if (!subtitles?.length) {
    return [];
  }

  const seen = new Set<string>();
  const tracks: SubtitleTrack[] = [];

  for (const subtitle of subtitles) {
    const url = subtitle.url ?? subtitle.src ?? subtitle.file ?? subtitle.href;
    if (!url || seen.has(url)) {
      continue;
    }
    seen.add(url);

    tracks.push({
      url,
      display: subtitle.language ?? subtitle.label ?? subtitle.lang?.toUpperCase(),
      language: normalizeLanguage(subtitle.lang, subtitle.language),
      release: subtitle.release,
    });
  }

  return tracks;
}

function normalizeLanguage(
  code: string | undefined,
  label: string | undefined,
): string | undefined {
  const raw = (code ?? label ?? "").trim().toLowerCase();
  if (!raw) {
    return undefined;
  }

  const normalized = raw
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const map: Record<string, string> = {
    eng: "en",
    english: "en",
    ara: "ar",
    arabic: "ar",
    spa: "es",
    spanish: "es",
    fre: "fr",
    fra: "fr",
    french: "fr",
    ger: "de",
    deu: "de",
    german: "de",
    jpn: "ja",
    japanese: "ja",
  };

  if (map[normalized]) {
    return map[normalized];
  }

  for (const [prefix, language] of Object.entries(map)) {
    if (normalized.startsWith(prefix)) {
      return language;
    }
  }

  return normalized;
}

function pickSubtitleTrack(
  subtitleList: SubtitleTrack[],
  preferredSubLang: string,
): SubtitleTrack | null {
  if (!subtitleList.length || preferredSubLang === "none") {
    return null;
  }

  const picked = selectSubtitle(subtitleList as never, preferredSubLang) as SubtitleTrack | null;
  if (!picked?.language) {
    return picked;
  }

  const sameLanguage = subtitleList.filter((track) => track.language === picked.language);
  const nonHi = sameLanguage.find((track) => !looksLikeHiSubtitle(track));
  return nonHi ?? picked;
}

function looksLikeHiSubtitle(track: SubtitleTrack): boolean {
  const raw = `${track.display ?? ""} ${track.release ?? ""}`.toLowerCase();
  return raw.includes("sdh") || /\bhi\b/.test(raw) || raw.includes("hearing");
}
