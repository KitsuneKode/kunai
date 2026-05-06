import type { ProviderRuntime, TitleIdentity } from "@kunai/types";

export interface StreamCacheKeyInput {
  readonly providerId: string;
  readonly providerVersion?: string;
  readonly title: Pick<TitleIdentity, "id" | "kind">;
  readonly season?: number;
  readonly episode?: number;
  readonly audioLanguage?: string;
  readonly subtitleLanguage?: string;
  readonly qualityPreference?: string;
  readonly resolverRuntime?: ProviderRuntime;
}

export function createStreamCacheKey(input: StreamCacheKeyInput): string {
  return stableKey([
    "stream",
    input.providerId,
    input.providerVersion ?? "unknown-version",
    input.title.kind,
    input.title.id,
    input.season ?? "none",
    input.episode ?? "none",
    normalizeKeyPart(input.audioLanguage),
    normalizeKeyPart(input.subtitleLanguage),
    normalizeKeyPart(input.qualityPreference),
    input.resolverRuntime ?? "unknown-runtime"
  ]);
}

export function stableKey(
  parts: readonly (string | number | boolean | null | undefined)[],
): string {
  return parts.map((part) => normalizeKeyPart(part)).join(":");
}

function normalizeKeyPart(part: string | number | boolean | null | undefined): string {
  if (part === null || part === undefined || part === "") {
    return "none";
  }

  return String(part).trim().toLowerCase().replaceAll(/\s+/g, "-");
}
