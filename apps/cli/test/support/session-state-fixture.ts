import { createInitialState, type SessionState } from "@/domain/session/SessionState";
import type { MediaLanguageProfile } from "@/services/persistence/ConfigService";

const DEFAULT_PROFILES: {
  anime: MediaLanguageProfile;
  series: MediaLanguageProfile;
  movie: MediaLanguageProfile;
} = {
  anime: { audio: "original", subtitle: "en" },
  series: { audio: "original", subtitle: "none" },
  movie: { audio: "original", subtitle: "en" },
};

/** Session state with sensible test defaults; spread overrides for focused cases. */
export function createSessionStateFixture(
  overrides: Partial<SessionState> = {},
  options: {
    readonly defaultProvider?: string;
    readonly defaultAnimeProvider?: string;
    readonly profiles?: typeof DEFAULT_PROFILES;
  } = {},
): SessionState {
  const base = createInitialState(
    options.defaultProvider ?? "vidking",
    options.defaultAnimeProvider ?? "allanime",
    options.profiles ?? DEFAULT_PROFILES,
  );
  return { ...base, ...overrides };
}
