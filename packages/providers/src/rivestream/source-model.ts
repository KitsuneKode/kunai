import type { ProviderVariantCandidate, StreamCandidate, SubtitleCandidate } from "@kunai/types";

import { ProviderHttpError } from "../runtime/fetch";
import { normalizeProviderDisplayLabel } from "../shared/source-inventory";

export type RivestreamProviderServicesResponse = {
  readonly data?: unknown;
};

export type RivestreamResolvedCandidate = {
  readonly provider: string;
  readonly sourceId: string;
  readonly streams: readonly StreamCandidate[];
  readonly variants: readonly ProviderVariantCandidate[];
  readonly subtitles: readonly SubtitleCandidate[];
  readonly candidateGateStream: StreamCandidate;
};

export type RivestreamRawSource = {
  readonly url?: string;
  readonly quality?: string;
  readonly format?: string;
  /** Headers captured before an observed wrapper is unwrapped. */
  readonly playbackHeaders?: Record<string, string>;
};

export type RivestreamSourceResponse = {
  readonly data?:
    | readonly RivestreamRawSource[]
    | {
        readonly sources?: readonly RivestreamRawSource[];
        readonly captions?: readonly RivestreamRawSubtitle[];
      };
};

export type RivestreamRawSubtitle = {
  readonly url?: string;
  readonly lang?: string;
  readonly language?: string;
  readonly file?: string;
  readonly label?: string;
};

export function getRivestreamRawSources(
  data: RivestreamSourceResponse["data"],
): readonly RivestreamRawSource[] {
  if (Array.isArray(data)) return data;
  if (isRivestreamSourceEnvelope(data)) return data.sources ?? [];
  return [];
}

function isRivestreamSourceEnvelope(
  data: RivestreamSourceResponse["data"],
): data is { readonly sources?: readonly RivestreamRawSource[] } {
  return typeof data === "object" && data !== null && !Array.isArray(data) && "sources" in data;
}

export function extractRivestreamCaptions(
  data: RivestreamSourceResponse["data"],
): readonly RivestreamRawSubtitle[] {
  if (!data || typeof data !== "object" || Array.isArray(data) || !("captions" in data)) {
    return [];
  }
  return Array.isArray(data.captions) ? data.captions : [];
}

export function rivestreamFailureClassFromProviderError(
  error: ProviderHttpError,
):
  | "candidate-network"
  | "candidate-empty"
  | "candidate-timeout"
  | "candidate-blocked"
  | "candidate-rate-limited"
  | "candidate-server-error"
  | "candidate-parse" {
  if (error.code === "timeout") return "candidate-timeout";
  if (error.code === "blocked") return "candidate-blocked";
  if (error.code === "rate-limited") return "candidate-rate-limited";
  if (error.code === "provider-unavailable") return "candidate-server-error";
  if (error.code === "parse-failed") return "candidate-parse";
  if (error.code === "not-found") return "candidate-empty";
  return "candidate-network";
}

export function displayRivestreamProviderLabel(provider: string): string {
  return normalizeProviderDisplayLabel(provider) ?? provider;
}

/** Short uppercase tag for the inferred audio language, e.g. "EN", "HI". */
function rivestreamAudioLanguageTag(provider: string): string | undefined {
  const language = inferRivestreamAudioLanguage(provider, undefined);
  return language ? language.toUpperCase() : undefined;
}

/** Human source label that also carries the inferred audio language at a glance. */
export function displayRivestreamSourceLabel(provider: string): string {
  const label = displayRivestreamProviderLabel(provider);
  const tag = rivestreamAudioLanguageTag(provider);
  return tag ? `${label} · ${tag}` : label;
}

export function inferRivestreamAudioSubtitle(provider: string): string {
  const language = inferRivestreamAudioLanguage(provider, undefined);
  const label = displayRivestreamProviderLabel(provider);
  if (language) {
    return `${language.toUpperCase()} · ${label}`;
  }
  return `Rivestream · ${label}`;
}

export function inferRivestreamAudioLanguage(
  provider: string | undefined,
  quality: string | undefined,
): string | undefined {
  const raw = [provider, quality].filter(Boolean).join(" ").toLowerCase();
  if (raw.includes("hindi")) return "hi";
  if (raw.includes("german")) return "de";
  if (raw.includes("spanish")) return "es";
  if (raw.includes("english") || raw.includes("flowcast") || raw.includes("primevids")) return "en";
  return undefined;
}
