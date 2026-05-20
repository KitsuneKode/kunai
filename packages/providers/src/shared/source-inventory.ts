import type {
  CachePolicy,
  ProviderId,
  ProviderLanguageEvidence,
  ProviderSourceCandidate,
  ProviderSourceEvidence,
  ProviderSourceKind,
  ProviderVariantCandidate,
  StreamCandidate,
  StreamPresentation,
  SubtitleDelivery,
} from "@kunai/types";

import { normalizeIsoLanguageCode } from "./subtitle-helpers";

export interface StableProviderInventoryIdInput {
  readonly prefix: string;
  readonly parts: readonly unknown[];
}

export function stableProviderInventoryId({
  prefix,
  parts,
}: StableProviderInventoryIdInput): string {
  const normalizedPrefix = normalizeIdSegment(prefix) || "id";
  const payload = parts.map(normalizeIdPart).join("\u001f");
  return `${normalizedPrefix}_${fnv1aBase36(payload).slice(0, 16)}`;
}

export function createSourceId(providerId: ProviderId | string, parts: readonly unknown[]): string {
  return stableProviderInventoryId({ prefix: "source", parts: [providerId, ...parts] });
}

export function createStreamId(providerId: ProviderId | string, parts: readonly unknown[]): string {
  return stableProviderInventoryId({ prefix: "stream", parts: [providerId, ...parts] });
}

export function createVariantId(
  providerId: ProviderId | string,
  parts: readonly unknown[],
): string {
  return stableProviderInventoryId({ prefix: "var", parts: [providerId, ...parts] });
}

export function parseSourceHost(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname || undefined;
  } catch {
    return undefined;
  }
}

export function normalizeQualityLabel(value: string | number | undefined): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 ? `${Math.trunc(value)}p` : undefined;
  }

  const raw = typeof value === "string" ? value.trim() : undefined;
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  if (lower === "auto" || lower === "default" || lower === "unknown") return "auto";

  const numeric = lower.match(/(\d{3,4})\s*p?/);
  if (numeric?.[1]) return `${numeric[1]}p`;

  if (lower.includes("4k") || lower.includes("uhd")) return "2160p";
  if (lower.includes("full hd") || lower.includes("fhd")) return "1080p";
  if (lower === "hd") return "720p";
  if (lower === "sd") return "480p";

  return raw;
}

export function normalizeProviderDisplayLabel(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  const known: Record<string, string> = {
    cdn: "CDN",
    "mb-flix": "MB Flix",
    "mb flix": "MB Flix",
    "1movies": "1Movies",
    downloader2: "Downloader 2",
    flowcast: "FlowCast",
    primevids: "PrimeVids",
    hindicast: "HindiCast",
    "fm-hls": "FM HLS",
    "vid-mp4": "VID MP4",
  };
  const knownLabel = known[lower];
  if (knownLabel) return knownLabel;
  return raw
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

export function qualityRankFromLabel(value: string | number | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  const label = normalizeQualityLabel(value);
  if (!label || label === "auto") return undefined;
  const match = label.match(/(\d{3,4})p/i);
  return match?.[1] ? Number.parseInt(match[1], 10) : undefined;
}

export function createProviderLanguageEvidence(input: {
  readonly role: ProviderLanguageEvidence["role"];
  readonly value?: string;
  readonly nativeLabel?: string;
  readonly sourceId?: string;
  readonly confidence?: number;
  readonly metadata?: Record<string, unknown>;
}): ProviderLanguageEvidence {
  return compactObject({
    role: input.role,
    normalizedLanguage: normalizeIsoLanguageCode(input.value ?? input.nativeLabel),
    nativeLabel: input.nativeLabel ?? input.value,
    sourceId: input.sourceId,
    confidence: input.confidence,
    metadata: input.metadata,
  });
}

export function createProviderSourceEvidence(input: {
  readonly sourceId?: string;
  readonly serverId?: string;
  readonly nativeLabel?: string;
  readonly url?: string;
  readonly host?: string;
  readonly confidence?: number;
  readonly metadata?: Record<string, unknown>;
}): ProviderSourceEvidence {
  return compactObject({
    sourceId: input.sourceId,
    serverId: input.serverId,
    nativeLabel: input.nativeLabel,
    host: input.host ?? parseSourceHost(input.url),
    confidence: input.confidence,
    metadata: input.metadata,
  });
}

export function createSourceCandidateFromStream(input: {
  readonly providerId: ProviderId;
  readonly stream: StreamCandidate;
  readonly kind?: ProviderSourceKind;
  readonly label?: string;
  readonly selected?: boolean;
  readonly cachePolicy?: CachePolicy;
  readonly confidence?: number;
}): ProviderSourceCandidate {
  const sourceId =
    input.stream.sourceId ??
    createSourceId(input.providerId, [
      input.stream.serverName,
      input.stream.url,
      input.stream.deferredLocator,
      input.label,
    ]);
  const sourceEvidence = input.stream.sourceEvidence?.[0];
  return compactObject({
    id: sourceId,
    providerId: input.providerId,
    kind: input.kind ?? inferSourceKind(input.stream),
    label: input.label ?? input.stream.serverName ?? sourceEvidence?.nativeLabel,
    host: sourceEvidence?.host ?? parseSourceHost(input.stream.url),
    status: input.selected ? ("selected" as const) : ("available" as const),
    confidence: input.confidence ?? input.stream.confidence,
    requiresRuntime: undefined,
    cachePolicy: input.cachePolicy ?? input.stream.cachePolicy,
    languageEvidence: input.stream.languageEvidence,
    sourceEvidence: input.stream.sourceEvidence,
    artwork: input.stream.artwork,
    metadata: input.stream.metadata,
  });
}

export function createVariantCandidateFromStream(input: {
  readonly providerId: ProviderId;
  readonly stream: StreamCandidate;
  readonly subtitles?: readonly { readonly id: string; readonly sourceId?: string }[];
  readonly selected?: boolean;
  readonly label?: string;
  readonly confidence?: number;
}): ProviderVariantCandidate {
  const sourceId =
    input.stream.sourceId ??
    createSourceId(input.providerId, [input.stream.serverName, input.stream.url]);
  const id =
    input.stream.variantId ??
    createVariantId(input.providerId, [
      sourceId,
      input.stream.presentation,
      input.stream.qualityLabel,
      input.stream.subtitleDelivery,
      input.stream.hardSubLanguage,
      input.stream.audioLanguages?.join(","),
    ]);
  return compactObject({
    id,
    providerId: input.providerId,
    sourceId,
    label: input.label ?? describeVariantLabel(input.stream),
    qualityLabel: input.stream.qualityLabel,
    qualityRank: input.stream.qualityRank,
    protocol: input.stream.protocol,
    container: input.stream.container,
    audioLanguages: input.stream.audioLanguages,
    presentation: input.stream.presentation,
    hardSubLanguage: input.stream.hardSubLanguage,
    subtitleDelivery: input.stream.subtitleDelivery,
    subtitleLanguages: input.stream.subtitleLanguages,
    flavorArchetype: input.stream.flavorArchetype,
    flavorLabel: input.stream.flavorLabel,
    streamIds: [input.stream.id],
    subtitleIds: input.subtitles
      ?.filter((subtitle) => !subtitle.sourceId || subtitle.sourceId === sourceId)
      .map((subtitle) => subtitle.id),
    selected: input.selected,
    confidence: input.confidence ?? input.stream.confidence,
    languageEvidence: input.stream.languageEvidence,
    sourceEvidence: input.stream.sourceEvidence,
    artwork: input.stream.artwork,
    metadata: input.stream.metadata,
  });
}

function inferSourceKind(stream: StreamCandidate): ProviderSourceKind {
  if (stream.protocol === "iframe") return "embed";
  if (stream.protocol === "hls" || stream.protocol === "dash") return "manifest";
  if (stream.protocol === "mp4") return "direct-media";
  return "unknown";
}

function describeVariantLabel(stream: StreamCandidate): string | undefined {
  const parts = [
    describePresentation(stream.presentation, stream.subtitleDelivery),
    stream.qualityLabel,
    stream.flavorLabel,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function describePresentation(
  presentation: StreamPresentation | undefined,
  subtitleDelivery: SubtitleDelivery | undefined,
): string | undefined {
  if (presentation === "dub") return "Dub";
  if (presentation === "sub" && subtitleDelivery === "hardcoded") return "Hardsub";
  if (presentation === "sub") return "Sub";
  return undefined;
}

function normalizeIdPart(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map(normalizeIdPart).join(",");
  if (typeof value === "object")
    return JSON.stringify(sortObject(value as Record<string, unknown>));
  return String(value).trim().toLowerCase();
}

function normalizeIdSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function sortObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function fnv1aBase36(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(36);
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
