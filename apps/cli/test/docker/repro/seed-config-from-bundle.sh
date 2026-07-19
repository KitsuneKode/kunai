#!/usr/bin/env bash
# Seed a throwaway Kunai config.json from a redacted support bundle.
#
# Privacy: only uses redacted settings / enabledProviders. Never copies history,
# titles, search queries, stream URLs, tokens, or user data paths into the
# seeded profile.
#
# Usage:
#   seed-config-from-bundle.sh <bundle.json> <xdg-config-home>
set -euo pipefail

BUNDLE="${1:?bundle.json path required}"
XDG_CONFIG_HOME="${2:?XDG_CONFIG_HOME directory required}"

if [[ ! -f "$BUNDLE" ]]; then
  echo "seed-config: bundle not found: $BUNDLE" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "seed-config: jq is required on the host" >&2
  exit 1
fi

CONFIG_DIR="$XDG_CONFIG_HOME/kunai"
mkdir -p "$CONFIG_DIR"

# Reject bundles that still contain raw user-data payloads.
# Support bundles must not ship history rows; this is a belt-and-suspenders check.
if jq -e '(.history? != null) or (.watchHistory? != null) or (.userData? != null)' "$BUNDLE" >/dev/null; then
  echo "seed-config: refusing bundle that contains history/userData fields" >&2
  exit 1
fi

# Prefer optional redacted settings object when present (future / maintainer-augmented
# bundles). Whitelist only non-PII keys — never titleProviderPreferences contents
# that might encode title ids, tokens, paths, or sync credentials.
SETTINGS_JSON="$(jq -c '
  def is_scalar_or_list:
    type == "boolean" or type == "number" or type == "string"
    or (type == "array" and (map(type == "string" or type == "number" or type == "boolean") | all));

  def whitelist_settings:
    {
      defaultMode, provider, animeProvider, youtubeProvider,
      providerPriority, animeProviderPriority, youtubeProviderPriority,
      subLang, animeLang, animeLanguageProfile, seriesLanguageProfile,
      movieLanguageProfile, youtubeLanguageProfile,
      animeTitlePreference, headless, showMemory, autoNext,
      autoplayRecommendations, resumeStartChoicePrompt,
      skipRecap, skipIntro, skipPreview, skipCredits,
      footerHints, quitNearEndBehavior, continueSourcePreference,
      quitNearEndThresholdMode, mpvInProcessStreamReconnect,
      mpvInProcessStreamReconnectMaxAttempts,
      discoverShowOnStartup, discoverMode, discoverItemLimit,
      recommendationRailEnabled, showWatchTimeStats,
      minimalMode, zenMode, powerSaverMode, powerSaverAllowManualArtwork,
      presenceProvider, presencePrivacy,
      downloadsEnabled, offlineMode, autoDownload, autoDownloadNextCount,
      maxConcurrentDownloads, defaultDownloadQuality, autoCleanupWatched,
      recoveryMode, startupPriority, artworkPreviewsEnabled,
      offlineArtworkCacheEnabled, updateChecksEnabled, autoApplyBinaryUpdates,
      updateChannel, updateCheckIntervalDays,
      providerRelay: (
        .providerRelay
        | if type != "object" then null else
            {
              enabled: (.enabled // true),
              # Never seed reporter tokens or base URLs into a repro profile.
              baseUrl: "",
              token: "",
              fallbackToDirect: (.fallbackToDirect // true),
              providers: (.providers // {})
            }
          end
      )
    }
    | with_entries(select(.value != null));

  if (.settings | type) == "object" then
    (.settings | whitelist_settings)
  else
    null
  end
' "$BUNDLE")"

ENABLED_JSON="$(jq -c '(.environment.enabledProviders // []) | map(select(type == "string" and length > 0))' "$BUNDLE")"
DEBUG_FLAG="$(jq -r '.app.debug // false' "$BUNDLE")"

# Build minimal KitsuneConfig partial: defaults + enabled provider map.
# titleProviderPreferences / favoriteSources / sync tokens intentionally omitted.
CONFIG_JSON="$(jq -n \
  --argjson settings "$SETTINGS_JSON" \
  --argjson enabled "$ENABLED_JSON" \
  --argjson debug "$DEBUG_FLAG" '
  def providers_from_enabled($ids):
    if ($ids | length) == 0 then {}
    else ($ids | map({(.): {enabled: true}}) | add)
    end;

  (if $settings != null then $settings else {} end)
  | .providerRelay = (
      (.providerRelay // {})
      + {
          enabled: ((.providerRelay.enabled) // true),
          baseUrl: "",
          token: "",
          fallbackToDirect: ((.providerRelay.fallbackToDirect) // true),
          providers: (
            if ((.providerRelay.providers // {}) | length) > 0 then
              .providerRelay.providers
            else
              providers_from_enabled($enabled)
            end
          )
        }
    )
  | . + {
      # Repro profile markers — never import reporter identity or paths.
      presenceDiscordClientId: "",
      presenceDiscordOpenUrl: "",
      videasySessionToken: "",
      videasySessionExpiresAt: 0,
      downloadPath: "",
      mpvKunaiScriptPath: "",
      titleProviderPreferences: {},
      favoriteSources: [],
      protectedDownloadJobIds: [],
      sync: {
        anilist: { enabled: false, trackWatched: false, syncList: false },
        tmdb: { enabled: false, trackWatched: false, syncList: false }
      }
    }
  | if $debug == true then . + { showMemory: true } else . end
')"

# Final scrub: refuse to write if any obvious PII/secret keys slipped through.
if echo "$CONFIG_JSON" | jq -e '
  (.. | objects | keys[]) as $k
  | select(
      ($k | test("(?i)token|password|cookie|authorization|secret|history|titleId|displayTitle|query|username|email|path"))
      and ($k | IN(
        "downloadPath",
        "mpvKunaiScriptPath",
        "videasySessionToken",
        "presenceDiscordClientId",
        "presenceDiscordOpenUrl",
        "token",
        "baseUrl"
      ) | not)
    )
' >/dev/null 2>&1; then
  echo "seed-config: refusing to write config with unexpected sensitive keys" >&2
  exit 1
fi

# Force empty secrets even if whitelist somehow passed values.
CONFIG_JSON="$(echo "$CONFIG_JSON" | jq '
  .providerRelay.baseUrl = ""
  | .providerRelay.token = ""
  | .videasySessionToken = ""
  | .presenceDiscordClientId = ""
  | .presenceDiscordOpenUrl = ""
  | .downloadPath = ""
  | .mpvKunaiScriptPath = ""
  | .titleProviderPreferences = {}
  | .favoriteSources = []
')"

printf '%s\n' "$CONFIG_JSON" >"$CONFIG_DIR/config.json"
# Empty provider overrides — never import reporter overrides wholesale.
printf '{}\n' >"$CONFIG_DIR/providers.json"

echo "seed-config: wrote $CONFIG_DIR/config.json (redacted settings only; no history/user data)"
