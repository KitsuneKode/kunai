import { encodeProviderEpisodeIdentity, type ProviderEpisodeIdentity } from "@kunai/types";

export type PlaybackDeadStreamScope = string;

export type PlaybackDeadStreamScopeInput = {
  readonly titleId: string;
  readonly season?: number;
  readonly episode?: number;
  readonly providerEpisodeIdentity?: ProviderEpisodeIdentity;
  readonly providerId: string;
};

export type DeadStreamUrlLedger = {
  record(scope: PlaybackDeadStreamScope, url: string | null | undefined): void;
  list(scope: PlaybackDeadStreamScope): readonly string[];
  clear(scope: PlaybackDeadStreamScope): void;
};

export function createDeadStreamUrlLedger(): DeadStreamUrlLedger {
  const urlsByScope = new Map<PlaybackDeadStreamScope, Set<string>>();

  return {
    record(scope, url) {
      if (!url) return;
      const trimmed = url.trim();
      if (!trimmed) return;
      const urls = urlsByScope.get(scope) ?? new Set<string>();
      urls.add(trimmed);
      urlsByScope.set(scope, urls);
    },
    list(scope) {
      return [...(urlsByScope.get(scope) ?? [])];
    },
    clear(scope) {
      urlsByScope.delete(scope);
    },
  };
}

export function playbackDeadStreamScopeKey(input: PlaybackDeadStreamScopeInput): string {
  return [
    input.titleId,
    input.season ?? "movie",
    input.episode ?? "movie",
    input.providerId,
    input.providerEpisodeIdentity
      ? encodeProviderEpisodeIdentity(input.providerEpisodeIdentity)
      : "none",
  ].join(":");
}
