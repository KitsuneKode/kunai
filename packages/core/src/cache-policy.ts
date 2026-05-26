import type {
  CachePolicy,
  EpisodeIdentity,
  ProviderId,
  StartupPriority,
  TitleIdentity,
} from "@kunai/types";

export interface ProviderCacheKeyInput {
  readonly providerId: ProviderId;
  readonly title: Pick<TitleIdentity, "id" | "kind">;
  readonly episode?: Pick<EpisodeIdentity, "season" | "episode" | "absoluteEpisode">;
  readonly subtitleLanguage?: string;
  readonly qualityPreference?: string;
  readonly startupPriority?: StartupPriority;
}

export function createProviderCachePolicy(
  input: ProviderCacheKeyInput,
  overrides: Partial<CachePolicy> = {},
): CachePolicy {
  return {
    ttlClass: "stream-manifest",
    scope: "local",
    keyParts: createProviderCacheKeyParts(input),
    allowStale: true,
    ...overrides,
  };
}

export function createProviderCacheKeyParts(input: ProviderCacheKeyInput): readonly string[] {
  return [
    "provider",
    normalizePart(input.providerId),
    normalizePart(input.title.kind),
    normalizePart(input.title.id),
    normalizePart(input.episode?.season),
    normalizePart(input.episode?.episode),
    normalizePart(input.episode?.absoluteEpisode),
    normalizePart(input.subtitleLanguage),
    normalizePart(input.qualityPreference),
    normalizePart(input.startupPriority ?? "balanced"),
  ];
}

function normalizePart(value: string | number | undefined): string {
  if (value === undefined || value === "") {
    return "none";
  }

  return String(value).trim().toLowerCase().replaceAll(/\s+/g, "-");
}
