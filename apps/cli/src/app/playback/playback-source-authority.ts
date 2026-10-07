import type { LocalEpisodePlaybackResolution } from "@/app/playback/episode-playback-source";
import type { Provider } from "@/services/providers/Provider";

export type PlaybackSourceAuthority =
  | { readonly kind: "local"; readonly resolution: LocalEpisodePlaybackResolution }
  | { readonly kind: "provider"; readonly provider: Provider }
  | { readonly kind: "offline-unavailable" }
  | { readonly kind: "provider-unavailable"; readonly providerId: string };

/** Local validation and source preference belong to resolveLocal, before adapter lookup. */
export async function resolvePlaybackSourceAuthority(input: {
  readonly configuredProviderId: string;
  readonly offlineOnly: boolean;
  readonly resolveLocal: () => Promise<LocalEpisodePlaybackResolution | null>;
  readonly getProvider: (providerId: string) => Provider | undefined;
}): Promise<PlaybackSourceAuthority> {
  const local = await input.resolveLocal();
  if (local) return { kind: "local", resolution: local };
  if (input.offlineOnly) return { kind: "offline-unavailable" };
  const provider = input.getProvider(input.configuredProviderId);
  return provider
    ? { kind: "provider", provider }
    : { kind: "provider-unavailable", providerId: input.configuredProviderId };
}
