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
# providerRelay.providers is normalized to { enabled: boolean } only so nested
# token/baseUrl/secret fields cannot survive seeding.
SETTINGS_JSON="$(jq -c '
  # Note: do not use `// true` for enabled — jq treats false as missing.
  def normalize_providers:
    (. // {})
    | to_entries
    | map({
        key: .key,
        value: {
          enabled: (
            if (.value | type) == "object" then (.value.enabled != false)
            else true
            end
          )
        }
      })
    | from_entries;

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
              providers: ((.providers // {}) | normalize_providers)
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

  # Note: do not use `// true` for enabled — jq treats false as missing.
  def normalize_providers:
    (. // {})
    | to_entries
    | map({
        key: .key,
        value: {
          enabled: (
            if (.value | type) == "object" then (.value.enabled != false)
            else true
            end
          )
        }
      })
    | from_entries;

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
              (.providerRelay.providers | normalize_providers)
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

# Force empty top-level secrets and re-normalize providers (defense in depth).
CONFIG_JSON="$(echo "$CONFIG_JSON" | jq '
  # Note: do not use `// true` for enabled — jq treats false as missing.
  def normalize_providers:
    (. // {})
    | to_entries
    | map({
        key: .key,
        value: {
          enabled: (
            if (.value | type) == "object" then (.value.enabled != false)
            else true
            end
          )
        }
      })
    | from_entries;

  .providerRelay.baseUrl = ""
  | .providerRelay.token = ""
  | .providerRelay.providers = (.providerRelay.providers | normalize_providers)
  | .videasySessionToken = ""
  | .presenceDiscordClientId = ""
  | .presenceDiscordOpenUrl = ""
  | .downloadPath = ""
  | .mpvKunaiScriptPath = ""
  | .titleProviderPreferences = {}
  | .favoriteSources = []
')"

# Refuse to write if any secret-like string value is still non-empty, including
# nested providers.*.token. Empty-string placeholders for known secret keys are OK.
if echo "$CONFIG_JSON" | jq -e '
  def secret_key:
    test("(?i)^(token|password|cookie|authorization|secret|api[_-]?key)$")
    or test("(?i)(SessionToken|ClientSecret|AccessToken|RefreshToken)$");

  [.. | objects | to_entries[] | select(.key | secret_key) | .value]
  | map(select(type == "string" and length > 0))
  | length > 0
' >/dev/null; then
  echo "seed-config: refusing to write config with non-empty secret values" >&2
  exit 1
fi

# Also refuse unexpected sensitive key names that are not empty placeholders.
if echo "$CONFIG_JSON" | jq -e '
  (.. | objects | keys[]) as $k
  | select(
      ($k | test("(?i)password|cookie|authorization|secret|history|titleId|displayTitle|query|username|email"))
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

printf '%s\n' "$CONFIG_JSON" >"$CONFIG_DIR/config.json"
# Empty provider overrides — never import reporter overrides wholesale.
printf '{}\n' >"$CONFIG_DIR/providers.json"

echo "seed-config: wrote $CONFIG_DIR/config.json (redacted settings only; no history/user data)"
