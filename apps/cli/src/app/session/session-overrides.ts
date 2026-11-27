import type { HdrMode, MediaLanguageProfile } from "@kunai/config";

/**
 * Pure resolution of transient, in-memory config overrides a launch flag should
 * apply for the current session only. These are applied with `config.update()`
 * (memory-only) and never `save()`d, so they do not touch the user's config file.
 *
 * Keeping this pure lets us assert that each layout flag honestly flips the
 * config field its name implies, without booting the shell.
 */
export interface SessionOverrideArgs {
  readonly zen: boolean;
  readonly minimal: boolean;
  readonly plain?: boolean;
  readonly offline?: boolean;
  readonly quality?: string;
  readonly audio?: string;
  readonly subtitle?: string;
  readonly hdr?: HdrMode;
}

export interface SessionLayoutConfig {
  readonly zenMode: boolean;
  readonly minimalMode: boolean;
  readonly plainMode?: boolean;
  readonly offlineMode?: boolean;
  readonly hdrMode?: HdrMode;
  readonly animeLanguageProfile: MediaLanguageProfile;
  readonly seriesLanguageProfile: MediaLanguageProfile;
  readonly movieLanguageProfile: MediaLanguageProfile;
  readonly youtubeLanguageProfile: MediaLanguageProfile;
}

export type SessionConfigOverrides = Partial<{
  zenMode: boolean;
  minimalMode: boolean;
  plainMode: boolean;
  offlineMode: boolean;
  hdrMode: HdrMode;
  animeLanguageProfile: MediaLanguageProfile;
  seriesLanguageProfile: MediaLanguageProfile;
  movieLanguageProfile: MediaLanguageProfile;
  youtubeLanguageProfile: MediaLanguageProfile;
}>;

const LANGUAGE_LANES = [
  "animeLanguageProfile",
  "seriesLanguageProfile",
  "movieLanguageProfile",
  "youtubeLanguageProfile",
] as const;

/**
 * Returns only the fields that need flipping. `--zen` enables zen mode; `-m`/
 * `--minimal` enables minimal mode (companion-pane collapse, minimal footer, dim
 * header). `--zen` implies minimal upstream in cli-args, so a zen launch yields
 * both. `--quality`/`--audio`/`--sub` ride the per-lane language profiles for
 * this session — the same fields the Settings rows write, applied to all four
 * media profiles because a per-run pick should not care which lane the chosen
 * title resolves into, including YouTube: its resolver accepts the same quality
 * ceiling labels, while audio/subtitle preferences reach yt-dlp/mpv through the
 * profile. cli-args rejects values outside the shared vocabularies before this
 * runs, so an unsupported value can never be silently dropped here.
 * Already-matching fields are omitted so we never issue a no-op update.
 */
export function resolveSessionConfigOverrides(
  args: SessionOverrideArgs,
  config: SessionLayoutConfig,
): SessionConfigOverrides {
  const overrides: SessionConfigOverrides = {};
  if (args.zen && !config.zenMode) overrides.zenMode = true;
  if (args.minimal && !config.minimalMode) overrides.minimalMode = true;
  if (args.plain && !config.plainMode) overrides.plainMode = true;
  if (args.offline && !config.offlineMode) overrides.offlineMode = true;
  if (args.hdr !== undefined && args.hdr !== config.hdrMode) overrides.hdrMode = args.hdr;

  if (args.quality !== undefined || args.audio !== undefined || args.subtitle !== undefined) {
    for (const lane of LANGUAGE_LANES) {
      const current = config[lane];
      const next: MediaLanguageProfile = {
        ...current,
        quality: args.quality ?? current.quality,
        audio: args.audio ?? current.audio,
        subtitle: args.subtitle ?? current.subtitle,
      };
      if (
        next.quality !== current.quality ||
        next.audio !== current.audio ||
        next.subtitle !== current.subtitle
      ) {
        overrides[lane] = next;
      }
    }
  }

  return overrides;
}
