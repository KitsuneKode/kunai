// =============================================================================
// Config Service Implementation
// =============================================================================

import { dbg } from "@/logger";
import type { ContinueSourcePreference } from "@/services/continuation/continuation-source";
import {
  DEFAULT_OFFLINE_FREE_SPACE_RESERVE_BYTES,
  DEFAULT_OFFLINE_RUNWAY_TARGET,
  DEFAULT_UNKNOWN_EPISODE_ESTIMATE_BYTES,
} from "@/services/download/StorageBudgetPolicy";
import { MPV_IN_PROCESS_RECONNECT_MAX_ATTEMPTS, mergeKitsuneConfig } from "@kunai/config";
import { migrateLegacyProviderId } from "@kunai/providers";
import { normalizeRelayBaseUrl as normalizeRelayBaseUrlValue } from "@kunai/relay";
import {
  isJsonObject,
  isJsonString,
  type ProviderRelayConfig,
  type StartupPriority,
} from "@kunai/types";

import type {
  AnalyticsPingCompletion,
  ConfigService,
  KitsuneConfig,
  QuitNearEndBehavior,
  QuitNearEndThresholdMode,
  PresencePrivacy,
  PresenceProvider,
  RecoveryMode,
} from "./ConfigService";
import type { ConfigStore } from "./ConfigStore";
import { DEFAULT_CONFIG } from "./ConfigStore";
import { CREDENTIAL_KEYS, type CredentialVaultPort } from "./credential-vault";
import type { TuningConfig } from "./tuning";
import { resolveTuning } from "./tuning";

function normalizeSeriesProvider<T>(value: T, fallback = DEFAULT_CONFIG.provider): string {
  // Config JSON is untrusted at load: a number or object here must degrade to
  // the default, not crash startup on .trim().
  const normalized = isJsonString(value) ? value.trim() : "";
  if (!normalized) return fallback;
  return migrateLegacyProviderId(normalized);
}

function normalizeProviderIdList<T>(
  values: T,
  fallback: readonly string[] = [],
): readonly string[] {
  if (!Array.isArray(values)) return fallback.map(migrateLegacyProviderId);
  return [
    ...new Set(
      values
        .filter(isJsonString)
        .map((value) => migrateLegacyProviderId(value.trim()))
        .filter(Boolean),
    ),
  ];
}

function normalizeSubtitlePreference<T>(value: T): string {
  if (!isJsonString(value) || !value) return "none";
  if (value === "fzf") return "interactive";
  return value;
}

function normalizeQualityPreference<T>(value: T): string {
  const normalized = isJsonString(value) ? value.trim().toLowerCase() : "";
  if (!normalized || normalized === "auto") return "best";
  return normalized;
}

function normalizeLanguageProfile<T>(profile: T): KitsuneConfig["animeLanguageProfile"] {
  if (!isJsonObject(profile)) {
    return { audio: "original", subtitle: "none", quality: "best" };
  }
  return {
    audio: isJsonString(profile.audio) && profile.audio ? profile.audio : "original",
    subtitle: normalizeSubtitlePreference(profile.subtitle),
    quality: normalizeQualityPreference(profile.quality),
  };
}

function normalizeTitleProviderPreferences(
  value: Record<string, string> | undefined,
): Record<string, string> {
  if (!isJsonObject(value)) return {};
  const normalized: Record<string, string> = {};
  for (const [titleId, providerId] of Object.entries(value)) {
    if (!isJsonString(providerId)) continue;
    const trimmedTitleId = titleId.trim();
    const trimmedProviderId = providerId.trim();
    if (!trimmedTitleId || !trimmedProviderId) continue;
    normalized[trimmedTitleId] = trimmedProviderId;
  }
  return normalized;
}

function normalizeProviderRelayConfig<T>(value: T): ProviderRelayConfig {
  if (!value || typeof value !== "object") return DEFAULT_CONFIG.providerRelay;
  const raw = value as Partial<ProviderRelayConfig>;
  const baseUrl = normalizeRelayBaseUrl(raw.baseUrl);
  const providers: Record<string, { enabled?: boolean }> = {};
  if (raw.providers && typeof raw.providers === "object") {
    for (const [providerId, providerConfig] of Object.entries(raw.providers)) {
      if (!providerId.trim() || !providerConfig || typeof providerConfig !== "object") continue;
      providers[providerId.trim()] = {
        ...(typeof providerConfig.enabled === "boolean"
          ? { enabled: providerConfig.enabled }
          : null),
      };
    }
  }
  return {
    ...(typeof raw.enabled === "boolean" ? { enabled: raw.enabled } : null),
    baseUrl,
    token: normalizeOptionalSecret(raw.token),
    fallbackToDirect: raw.fallbackToDirect !== false,
    providers,
  };
}

function normalizeRelayBaseUrl<T>(value: T): string {
  if (typeof value !== "string") return "";
  return normalizeRelayBaseUrlValue(value) ?? "";
}

/**
 * The config schema validates `providerRelay` only and preserves the rest verbatim,
 * so a hand-edited `config.json` can put a number or an object where a string
 * belongs. `.trim()` on that throws inside `load()`, which takes down startup for a
 * field nothing critical depends on.
 */
function trimmedConfigString<T>(value: T): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeYoutubeMetadata(
  value: KitsuneConfig["youtubeMetadata"] | undefined,
): KitsuneConfig["youtubeMetadata"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_CONFIG.youtubeMetadata };
  }
  const entries = {
    instanceUrl: trimmedConfigString(value.instanceUrl),
    pipedApiUrl: trimmedConfigString(value.pipedApiUrl),
    cookiesFromBrowser: trimmedConfigString(value.cookiesFromBrowser),
    cookiesFile: trimmedConfigString(value.cookiesFile),
    extractorArgs: trimmedConfigString(value.extractorArgs),
    poToken: trimmedConfigString(value.poToken),
    sponsorblockRemove: trimmedConfigString(value.sponsorblockRemove),
  };
  return Object.fromEntries(
    Object.entries(entries).filter(([, entry]) => entry !== undefined),
  ) as KitsuneConfig["youtubeMetadata"];
}

export class ConfigServiceImpl implements ConfigService {
  private config: KitsuneConfig;
  /**
   * Transient launch-flag overrides (`--zen`, `-m`). Held apart from `config` so
   * `save()` — which persists the whole object, and which UpdateService and
   * UsageAnalyticsService both call unconditionally on startup — can never bake a
   * one-run flag into the user's config file.
   */
  private sessionOverrides: Partial<KitsuneConfig> = {};
  /**
   * Keys this process changed via `update()`. A second kunai instance shares
   * config.json: without per-key tracking, our debounced whole-document write
   * reverted whatever it changed between our `load()` and our `save()` —
   * including an analytics opt-out, which a passive instance's bookkeeping
   * writes (update-check stamps, analytics ping) kept silently undoing.
   * Persist merges `{onDisk, dirtyKeys}` — per-key last-writer-wins — instead.
   */
  private readonly dirtyKeys = new Set<keyof KitsuneConfig>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saveTimeoutMs = 300;
  /** Set when load() auto-migrated legacy videasyAppId to bc-frontend. */
  videasyAppIdMigratedOnLoad = false;

  constructor(
    private store: ConfigStore,
    private vault?: CredentialVaultPort,
  ) {
    this.config = { ...DEFAULT_CONFIG };
  }

  /** Whether the vault holds the videasy token — hydrated or migrated this session. */
  private videasyTokenVaulted = false;

  static async load(store: ConfigStore, vault?: CredentialVaultPort): Promise<ConfigServiceImpl> {
    const load = () => ConfigServiceImpl.loadWithinLock(store, vault);
    return store.withLock ? store.withLock(load) : load();
  }

  private static async loadWithinLock(
    store: ConfigStore,
    vault?: CredentialVaultPort,
  ): Promise<ConfigServiceImpl> {
    const service = new ConfigServiceImpl(store, vault);
    const loaded = await store.load();
    // Configs written before explicit consent had no notice marker. Their
    // enabled value was opt-out state, not evidence of a current opt-in, so
    // revoke it and erase the old local identifier before startup can send.
    const requiresExplicitAnalyticsConsent =
      loaded.analytics === "enabled" && typeof loaded.analyticsNoticeShown !== "boolean";
    const normalizedAnalytics = requiresExplicitAnalyticsConsent
      ? "unset"
      : normalizeAnalyticsPreference(loaded.analytics);
    const normalizedInstallId =
      normalizedAnalytics === "enabled" && typeof loaded.installId === "string"
        ? loaded.installId.trim()
        : "";
    const repairedAnalyticsIdentity =
      loaded.installId !== undefined && loaded.installId !== normalizedInstallId;
    const migratedAnimeDefaults = shouldMigrateInheritedAnimeDefaults(loaded);
    const migratedSeriesDefaults = shouldMigrateInheritedSeriesDefaults(loaded);
    // mergeKitsuneConfig supplies the base: object-valued keys (sync and its
    // anilist/tmdb sections, language profiles, youtubeMetadata, relay config,
    // title-provider prefs) overlay DEFAULT_CONFIG field-by-field, so a
    // hand-edited `{"sync":{"anilist":null}}` can never put null where
    // unguarded readers do `config.sync.anilist.enabled`.
    service.config = {
      ...mergeKitsuneConfig(DEFAULT_CONFIG, loaded),
      ...(migratedSeriesDefaults
        ? {
            provider: DEFAULT_CONFIG.provider,
            providerPriority: [...DEFAULT_CONFIG.providerPriority],
          }
        : {
            provider: normalizeSeriesProvider(loaded.provider),
            providerPriority: normalizeProviderIdList(
              loaded.providerPriority,
              DEFAULT_CONFIG.providerPriority,
            ),
          }),
      ...(migratedAnimeDefaults
        ? {
            animeProvider: DEFAULT_CONFIG.animeProvider,
            animeProviderPriority: [...DEFAULT_CONFIG.animeProviderPriority],
          }
        : {
            animeProvider: normalizeSeriesProvider(
              loaded.animeProvider,
              DEFAULT_CONFIG.animeProvider,
            ),
            animeProviderPriority: normalizeProviderIdList(
              loaded.animeProviderPriority,
              DEFAULT_CONFIG.animeProviderPriority,
            ),
          }),
      providerDefaultsRevision: Math.max(
        readProviderDefaultsRevision(loaded),
        CURRENT_PROVIDER_DEFAULTS_REVISION,
      ),
      youtubeProvider: normalizeSeriesProvider(
        loaded.youtubeProvider,
        DEFAULT_CONFIG.youtubeProvider,
      ),
      youtubeProviderPriority: normalizeProviderIdList(
        loaded.youtubeProviderPriority,
        DEFAULT_CONFIG.youtubeProviderPriority,
      ),
      youtubeLanguageProfile: normalizeLanguageProfile(
        loaded.youtubeLanguageProfile ?? DEFAULT_CONFIG.youtubeLanguageProfile,
      ),
      youtubeMetadata: normalizeYoutubeMetadata(loaded.youtubeMetadata),
      animeLanguageProfile: normalizeLanguageProfile(loaded.animeLanguageProfile),
      seriesLanguageProfile: normalizeLanguageProfile(loaded.seriesLanguageProfile),
      movieLanguageProfile: normalizeLanguageProfile(loaded.movieLanguageProfile),
      offlineFreeSpaceReserveBytes: normalizeBytes(
        loaded.offlineFreeSpaceReserveBytes,
        DEFAULT_OFFLINE_FREE_SPACE_RESERVE_BYTES,
      ),
      offlineUnknownEpisodeEstimateBytes: normalizeBytes(
        loaded.offlineUnknownEpisodeEstimateBytes,
        DEFAULT_UNKNOWN_EPISODE_ESTIMATE_BYTES,
      ),
      offlineDefaultRunwayTarget: normalizeRunwayTarget(loaded.offlineDefaultRunwayTarget),
      protectedDownloadJobIds: normalizeStringList(loaded.protectedDownloadJobIds),
      favoriteSources: normalizeStringList(loaded.favoriteSources),
      recoveryMode: normalizeRecoveryMode(loaded.recoveryMode),
      continueSourcePreference: normalizeContinueSourcePreference(loaded.continueSourcePreference),
      startupPriority: normalizeStartupPriority(loaded.startupPriority),
      mpvInProcessStreamReconnectMaxAttempts: normalizeMpvReconnectAttempts(
        loaded.mpvInProcessStreamReconnectMaxAttempts,
      ),
      videasySessionToken: normalizeOptionalSecret(loaded.videasySessionToken),
      videasySessionExpiresAt: normalizeVideasySessionExpiresAt(
        loaded.videasySessionExpiresAt,
        loaded.videasySessionToken,
      ),
      videasyAppId: normalizeVideasyAppId(
        loaded.videasyAppId,
        normalizeOptionalSecret(loaded.videasySessionToken),
      ),
      providerRelay: normalizeProviderRelayConfig(loaded.providerRelay),
      titleProviderPreferences: normalizeTitleProviderPreferences(loaded.titleProviderPreferences),
      analytics: normalizedAnalytics,
      analyticsNoticeShown: loaded.analyticsNoticeShown === true,
      installId: normalizedInstallId,
      lastAnalyticsPingAt:
        typeof loaded.lastAnalyticsPingAt === "number" &&
        Number.isFinite(loaded.lastAnalyticsPingAt)
          ? Math.max(0, loaded.lastAnalyticsPingAt)
          : 0,
      analyticsRetryAfter:
        typeof loaded.analyticsRetryAfter === "number" &&
        Number.isFinite(loaded.analyticsRetryAfter)
          ? Math.max(0, loaded.analyticsRetryAfter)
          : 0,
      analyticsEndpoint:
        typeof loaded.analyticsEndpoint === "string" ? loaded.analyticsEndpoint.trim() : "",
    };
    // One debug line, not per-field: enough to see what normalization did on a
    // bug report without spamming --debug. Secrets never land here — tokens are
    // presence booleans, and the relay URL is host-only.
    dbg("config", "normalized config on load", {
      provider: service.config.provider,
      providerPriority: service.config.providerPriority,
      animeProvider: service.config.animeProvider,
      animeProviderPriority: service.config.animeProviderPriority,
      analytics: service.config.analytics,
      analyticsNoticeShown: service.config.analyticsNoticeShown,
      hasInstallId: service.config.installId.length > 0,
      recoveryMode: service.config.recoveryMode,
      startupPriority: service.config.startupPriority,
      relayEnabled: service.config.providerRelay.enabled !== false,
      relayHost: relayHostForDebug(service.config.providerRelay.baseUrl),
      hasRelayToken: (service.config.providerRelay.token ?? "").length > 0,
      hasVideasySession: service.config.videasySessionToken.length > 0,
      migratedAnimeDefaults,
      migratedSeriesDefaults,
    });
    const migratedVideasyAppId = shouldPersistVideasyAppIdMigration(loaded, service.config);
    // Vault lane: hydrate the in-memory token from the vault when config.json
    // no longer carries it, or migrate plaintext that predates the vault. The
    // scrubbed write below is what removes it from disk — the in-memory config
    // keeps serving it so consumers never learn where it lives.
    let videasyVaultResave = false;
    if (vault && vault.backend !== "file") {
      try {
        const key = CREDENTIAL_KEYS.videasySessionToken;
        if (service.config.videasySessionToken) {
          await vault.set(key, service.config.videasySessionToken);
          if ((await vault.get(key)) === service.config.videasySessionToken) {
            service.videasyTokenVaulted = true;
            videasyVaultResave = true;
          }
        } else {
          const vaulted = await vault.get(key);
          if (vaulted) {
            service.config = { ...service.config, videasySessionToken: vaulted };
            service.videasyTokenVaulted = true;
          }
        }
      } catch {
        // Vault write/read failed — keep the plaintext and retry next launch.
      }
    }
    // Normalization heals on disk: a key whose stored value parsed but
    // normalized differently (legacy enums, clamps, trims) stays dirty so the
    // next merge save rewrites just that key — the heal the old whole-document
    // write used to provide, without reverting keys another instance changed.
    // SAFETY: Object.keys of a Partial<KitsuneConfig> only yields its keys.
    for (const key of Object.keys(loaded) as (keyof KitsuneConfig)[]) {
      if (loaded[key] === undefined) continue;
      // Hydration is not permission to overwrite a rotated native token.
      if (key === "videasySessionToken" && loaded[key] === "" && service.videasyTokenVaulted)
        continue;
      if (JSON.stringify(loaded[key]) !== JSON.stringify(service.config[key])) {
        service.dirtyKeys.add(key);
      }
    }
    if (
      requiresExplicitAnalyticsConsent ||
      repairedAnalyticsIdentity ||
      migratedVideasyAppId ||
      videasyVaultResave ||
      migratedAnimeDefaults ||
      migratedSeriesDefaults
    ) {
      // Migrations changed keys nothing marked dirty — without the flag the
      // persist would merge over the live file and drop them.
      service.needsFullConfigWrite = true;
      await service.persistConfigNow(true);
      service.videasyAppIdMigratedOnLoad = migratedVideasyAppId;
    }
    return service;
  }

  /**
   * Persist config.json with vaulted secrets stripped from the on-disk shape.
   * The value lives in the vault; `videasySessionToken` in the file is "".
   * write → read-back → compare before the plaintext is ever omitted, and on
   * replacement failure retains plaintext; an unverified clear rejects the
   * save and keeps its dirty key retryable.
   */
  /**
   * Serializes config.json writes. A persist's `await store.load()` yields the
   * loop, so two overlapping persists can each merge over a snapshot missing
   * the other's write — the last one to land reverts it, and its dirty keys
   * were already cleared. Chaining makes every write read the file the
   * previous write left behind.
   */
  private persistChain: Promise<void> = Promise.resolve();
  /**
   * Set by `load()` when migrated/repaired config must persist verbatim —
   * the only path allowed to write the in-memory snapshot whole. A save
   * with no dirty keys and no flag merges over the live file instead, so a
   * stale boot snapshot can never revert keys another instance wrote.
   */
  private needsFullConfigWrite = false;

  private persistConfig(): Promise<void> {
    // persistChain only orders this instance — the cross-process lock lives
    // inside persistConfigNow. Startup owns its initial read and migration,
    // and explicit native credential changes share that critical section.
    const run = this.persistChain.then(() => this.persistConfigNow());
    this.persistChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  recordAnalyticsPing(completion: AnalyticsPingCompletion): Promise<boolean> {
    const write = async (): Promise<boolean> => {
      const complete = async (): Promise<boolean> => {
        // Consent changes in this process can still be awaiting their save.
        const matchesLocal = () =>
          this.config.analytics === "enabled" && this.config.installId === completion.installId;
        if (!matchesLocal()) return false;
        const onDisk = await this.store.load();
        if (!matchesLocal()) return false;
        const matchesDisk =
          onDisk.analytics === "enabled" && onDisk.installId === completion.installId;
        const current = { ...DEFAULT_CONFIG, ...onDisk };
        if (matchesDisk) {
          current.analyticsRetryAfter = completion.analyticsRetryAfter;
          if (completion.lastAnalyticsPingAt !== undefined)
            current.lastAnalyticsPingAt = completion.lastAnalyticsPingAt;
          // Never persist the pre-send identity: this write owns cadence only.
          await this.store.save(current);
        }
        // A local consent/identity change may arrive during the async write.
        // Its queued save wins next; do not refresh it with the old cadence.
        if (!matchesLocal()) return false;
        const analyticsKeys: readonly (keyof KitsuneConfig)[] = [
          "analytics",
          "installId",
          "lastAnalyticsPingAt",
          "analyticsRetryAfter",
        ];
        for (const key of analyticsKeys) {
          if (!this.dirtyKeys.has(key)) Object.assign(this.config, { [key]: current[key] });
        }
        return matchesDisk;
      };
      return this.store.withLock ? this.store.withLock(complete) : complete();
    };
    // Share the save chain so completion cannot interleave its read/merge/write.
    const run = this.persistChain.then(write);
    this.persistChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async persistConfigNow(alreadyLocked = false): Promise<void> {
    // Read the live config when the write actually runs — a chained persist
    // executes after any updates queued behind it, and a stale snapshot here
    // would write old values for keys it then clears from dirtyKeys.
    const config = this.config;
    // Read once, cleared only after a successful write — a failed full-write
    // keeps the flag so the next persist still writes the migrated snapshot.
    const forceFullWrite = this.needsFullConfigWrite;

    const writeOnce = async (): Promise<void> => {
      // Only explicit token changes write the vault. Keep its transition inside
      // the config lock so sibling rotations and the file scrub share an owner.
      let scrubToken = this.videasyTokenVaulted;
      if (
        this.vault &&
        this.vault.backend !== "file" &&
        this.dirtyKeys.has("videasySessionToken")
      ) {
        const key = CREDENTIAL_KEYS.videasySessionToken;
        const token = config.videasySessionToken;
        scrubToken = false;
        if (token) {
          this.videasyTokenVaulted = false;
          try {
            await this.vault.set(key, token);
            if ((await this.vault.get(key)) === token) {
              this.videasyTokenVaulted = true;
              scrubToken = true;
            }
          } catch {
            // A failed replacement retains its plaintext for a later migration.
          }
        } else {
          // A sibling may have added a token since hydration. A clear must
          // remove it too, and must not claim success if native deletion failed.
          await this.vault.delete(key);
          if ((await this.vault.get(key)) !== undefined)
            throw new Error("Native credential clear could not be verified");
          this.videasyTokenVaulted = false;
        }
      }
      // When this process has updated keys, write per-key over the CURRENT
      // file rather than our loaded-at-boot snapshot. The merge window shrinks
      // a lost-update race from the session's lifetime to one read→write pair
      // — and the lockfile closes that pair against sibling instances; a
      // store.load() failure falls back to the whole-document write.
      let toWrite = config;
      let mergedKeys: ReadonlySet<keyof KitsuneConfig> | null = null;
      let mergedValues: Partial<KitsuneConfig> | null = null;
      if (forceFullWrite) {
        toWrite = config;
      } else if (this.dirtyKeys.size > 0) {
        mergedKeys = new Set(this.dirtyKeys);
        try {
          const onDisk = await this.store.load();
          const dirtySubset: Partial<KitsuneConfig> = {};
          for (const key of mergedKeys) {
            Object.assign(dirtySubset, { [key]: config[key] });
          }
          toWrite = { ...DEFAULT_CONFIG, ...onDisk, ...dirtySubset };
          mergedValues = dirtySubset;
        } catch {
          toWrite = config;
          mergedKeys = null;
        }
      } else {
        // Nothing session-dirty: writing the boot snapshot whole would revert
        // keys another instance persisted after our last read. Refreshing over
        // the live file is a no-op content-wise that still self-heals a
        // deleted or truncated config.json.
        try {
          const onDisk = await this.store.load();
          toWrite = { ...DEFAULT_CONFIG, ...onDisk };
        } catch {
          toWrite = config;
        }
      }
      await this.store.save(scrubToken ? { ...toWrite, videasySessionToken: "" } : toWrite);
      if (forceFullWrite) this.needsFullConfigWrite = false;
      this.clearPersistedDirtyKeys(mergedKeys, mergedValues ?? toWrite);
    };

    const withLock = this.store.withLock?.bind(this.store);
    if (withLock && !alreadyLocked) {
      await withLock(writeOnce);
    } else {
      await writeOnce();
    }
  }

  private clearPersistedDirtyKeys(
    mergedKeys: ReadonlySet<keyof KitsuneConfig> | null,
    written: Partial<KitsuneConfig>,
  ): void {
    // A key re-dirtied while the write was in flight keeps its flag — the
    // next persist carries the newer value instead of reverting to what was
    // saved. On a whole-document write every dirty key was persisted, so the
    // current dirty set is the comparison set.
    const keys = mergedKeys ?? [...this.dirtyKeys];
    for (const key of keys) {
      if (this.config[key] === written[key]) this.dirtyKeys.delete(key);
    }
  }

  // Accessors
  get provider(): string {
    return this.config.provider;
  }

  get defaultMode(): KitsuneConfig["defaultMode"] {
    return this.config.defaultMode;
  }

  get animeProvider(): string {
    return this.config.animeProvider;
  }

  get youtubeProvider(): string {
    return this.config.youtubeProvider;
  }

  get youtubeProviderPriority(): readonly string[] {
    return [...this.config.youtubeProviderPriority];
  }

  get youtubeLanguageProfile(): import("./ConfigService").MediaLanguageProfile {
    return this.config.youtubeLanguageProfile;
  }

  get youtubeMetadata(): KitsuneConfig["youtubeMetadata"] {
    return { ...this.config.youtubeMetadata };
  }

  get providerPriority(): readonly string[] {
    return [...this.config.providerPriority];
  }

  get animeProviderPriority(): readonly string[] {
    return [...this.config.animeProviderPriority];
  }

  get wyzieApiKey(): string {
    return this.config.wyzieApiKey;
  }

  get animeLanguageProfile(): import("./ConfigService").MediaLanguageProfile {
    return this.config.animeLanguageProfile;
  }

  get seriesLanguageProfile(): import("./ConfigService").MediaLanguageProfile {
    return this.config.seriesLanguageProfile;
  }

  get movieLanguageProfile(): import("./ConfigService").MediaLanguageProfile {
    return this.config.movieLanguageProfile;
  }

  get animeTitlePreference(): "english" | "romaji" | "native" | "provider" {
    return this.config.animeTitlePreference;
  }

  get showMemory(): boolean {
    return this.config.showMemory;
  }

  get autoNext(): boolean {
    return this.config.autoNext;
  }

  get autoplayRecommendations(): boolean {
    return this.config.autoplayRecommendations;
  }

  get favoriteSources(): readonly string[] {
    return this.config.favoriteSources;
  }

  get resumeStartChoicePrompt(): boolean {
    return this.config.resumeStartChoicePrompt;
  }

  get skipRecap(): boolean {
    return this.config.skipRecap;
  }

  get skipIntro(): boolean {
    return this.config.skipIntro;
  }

  get skipPreview(): boolean {
    return this.config.skipPreview;
  }

  get skipCredits(): boolean {
    return this.config.skipCredits;
  }

  get footerHints(): "detailed" | "minimal" {
    return this.config.footerHints;
  }

  get companionPet(): "auto" | "off" {
    return this.config.companionPet;
  }

  get quitNearEndBehavior(): QuitNearEndBehavior {
    return this.config.quitNearEndBehavior;
  }

  get quitNearEndThresholdMode(): QuitNearEndThresholdMode {
    return this.config.quitNearEndThresholdMode;
  }

  get mpvKunaiScriptPath(): string {
    return this.config.mpvKunaiScriptPath;
  }

  get mpvKunaiScriptOpts(): Record<string, string> {
    return { ...this.config.mpvKunaiScriptOpts };
  }

  get mpvInProcessStreamReconnect(): boolean {
    return this.config.mpvInProcessStreamReconnect;
  }

  get mpvInProcessStreamReconnectMaxAttempts(): number {
    return this.config.mpvInProcessStreamReconnectMaxAttempts;
  }

  get presenceProvider(): PresenceProvider {
    return this.config.presenceProvider;
  }

  get presencePrivacy(): PresencePrivacy {
    return this.config.presencePrivacy;
  }

  get presenceDiscordClientId(): string {
    return this.config.presenceDiscordClientId;
  }

  get presenceDiscordOpenUrl(): string {
    return this.config.presenceDiscordOpenUrl;
  }

  get videasySessionToken(): string {
    if (isExpiredVideasySession(this.config.videasySessionExpiresAt)) return "";
    return this.config.videasySessionToken;
  }

  get providerRelay(): ProviderRelayConfig {
    return {
      ...this.config.providerRelay,
      providers: { ...this.config.providerRelay.providers },
    };
  }

  get videasySessionExpiresAt(): number {
    return this.config.videasySessionExpiresAt;
  }

  get videasyAppId(): KitsuneConfig["videasyAppId"] {
    return this.config.videasyAppId;
  }

  get downloadsEnabled(): boolean {
    return this.config.downloadsEnabled;
  }

  get offlineMode(): boolean {
    return this.config.offlineMode;
  }

  get maxConcurrentDownloads(): number {
    return normalizeMaxConcurrentDownloads(this.config.maxConcurrentDownloads);
  }

  get defaultDownloadQuality(): string {
    return normalizeQualityPreference(this.config.defaultDownloadQuality);
  }

  get autoCleanupWatched(): boolean {
    return this.config.autoCleanupWatched;
  }

  get recoveryMode(): RecoveryMode {
    return this.config.recoveryMode;
  }

  get continueSourcePreference(): KitsuneConfig["continueSourcePreference"] {
    return this.config.continueSourcePreference;
  }

  get startupPriority(): StartupPriority {
    return this.config.startupPriority;
  }

  get offlineArtworkCacheEnabled(): boolean {
    return this.config.offlineArtworkCacheEnabled;
  }

  get offlineFreeSpaceReserveBytes(): number {
    return this.config.offlineFreeSpaceReserveBytes;
  }

  get offlineUnknownEpisodeEstimateBytes(): number {
    return this.config.offlineUnknownEpisodeEstimateBytes;
  }

  get offlineDefaultRunwayTarget(): number {
    return this.config.offlineDefaultRunwayTarget;
  }

  get autoCleanupGraceDays(): number {
    return this.config.autoCleanupGraceDays;
  }

  get protectedDownloadJobIds(): readonly string[] {
    return [...this.config.protectedDownloadJobIds];
  }

  get titleProviderPreferences(): Record<string, string> {
    return { ...this.config.titleProviderPreferences };
  }

  get onboardingVersion(): number {
    return this.config.onboardingVersion;
  }

  get downloadPath(): string {
    return this.config.downloadPath;
  }

  get downloadOnboardingDismissed(): boolean {
    return this.config.downloadOnboardingDismissed;
  }

  get playbackKeysSessionsSeen(): number {
    return this.config.playbackKeysSessionsSeen;
  }

  get analytics(): KitsuneConfig["analytics"] {
    return this.config.analytics;
  }

  get analyticsNoticeShown(): boolean {
    return this.config.analyticsNoticeShown;
  }

  get installId(): string {
    return this.config.installId;
  }

  get lastAnalyticsPingAt(): number {
    return this.config.lastAnalyticsPingAt;
  }

  get analyticsRetryAfter(): number {
    return this.config.analyticsRetryAfter;
  }

  get analyticsEndpoint(): string {
    return this.config.analyticsEndpoint;
  }

  get updateChecksEnabled(): boolean {
    return this.config.updateChecksEnabled;
  }

  get autoApplyBinaryUpdates(): boolean {
    return this.config.autoApplyBinaryUpdates;
  }

  get updateCheckIntervalDays(): number {
    return this.config.updateCheckIntervalDays;
  }

  get updateSnoozedUntil(): number {
    return this.config.updateSnoozedUntil;
  }

  get lastUpdateCheckAt(): number {
    return this.config.lastUpdateCheckAt;
  }

  get lastUpdateCheckFailedAt(): number {
    return this.config.lastUpdateCheckFailedAt;
  }

  get lastKnownLatestVersion(): string {
    return this.config.lastKnownLatestVersion;
  }

  get discoverShowOnStartup(): boolean {
    return this.config.discoverShowOnStartup;
  }

  get discoverMode(): "auto" | "unified" | "anime-only" | "series-only" {
    return this.config.discoverMode;
  }

  get discoverItemLimit(): number {
    return this.config.discoverItemLimit;
  }

  get recommendationRailEnabled(): boolean {
    return this.config.recommendationRailEnabled;
  }

  get showWatchTimeStats(): boolean {
    return this.config.showWatchTimeStats;
  }

  get lastCalendarVisitAt(): number {
    return this.config.lastCalendarVisitAt;
  }

  get minimalMode(): boolean {
    return this.sessionOverrides.minimalMode ?? this.config.minimalMode;
  }

  get zenMode(): boolean {
    return this.sessionOverrides.zenMode ?? this.config.zenMode;
  }

  get powerSaverMode(): boolean {
    return this.config.powerSaverMode;
  }

  get tuning(): TuningConfig {
    return resolveTuning(this.config.tuningOverrides);
  }

  get sync(): KitsuneConfig["sync"] {
    return this.config.sync;
  }

  get lastWeeklyDigestShownAt(): string | null | undefined {
    return this.config.lastWeeklyDigestShownAt;
  }

  getRaw(): KitsuneConfig {
    return { ...this.config, ...this.sessionOverrides };
  }

  /**
   * Apply launch-flag overrides for this run only. Readers see them; `save()`
   * never does. An explicit `update()` of the same key later in the session
   * clears the override, so changing the setting in `/settings` wins over the
   * flag instead of being silently masked by it.
   */
  applySessionOverrides(partial: Partial<KitsuneConfig>): void {
    this.sessionOverrides = { ...this.sessionOverrides, ...partial };
  }

  async update(partial: Partial<KitsuneConfig>): Promise<void> {
    // SAFETY: Object.keys of a Partial<KitsuneConfig> only yields its keys.
    for (const key of Object.keys(partial) as (keyof KitsuneConfig)[]) {
      if (key in this.sessionOverrides) delete this.sessionOverrides[key];
      this.dirtyKeys.add(key);
    }
    this.config = {
      ...this.config,
      ...partial,
      ...(partial.providerPriority !== undefined
        ? { providerPriority: normalizeProviderIdList(partial.providerPriority) }
        : null),
      ...(partial.animeProviderPriority !== undefined
        ? { animeProviderPriority: normalizeProviderIdList(partial.animeProviderPriority) }
        : null),
      ...(partial.animeLanguageProfile
        ? { animeLanguageProfile: normalizeLanguageProfile(partial.animeLanguageProfile) }
        : null),
      ...(partial.seriesLanguageProfile
        ? { seriesLanguageProfile: normalizeLanguageProfile(partial.seriesLanguageProfile) }
        : null),
      ...(partial.movieLanguageProfile
        ? { movieLanguageProfile: normalizeLanguageProfile(partial.movieLanguageProfile) }
        : null),
      ...(partial.offlineFreeSpaceReserveBytes !== undefined
        ? {
            offlineFreeSpaceReserveBytes: normalizeBytes(
              partial.offlineFreeSpaceReserveBytes,
              DEFAULT_OFFLINE_FREE_SPACE_RESERVE_BYTES,
            ),
          }
        : null),
      ...(partial.offlineUnknownEpisodeEstimateBytes !== undefined
        ? {
            offlineUnknownEpisodeEstimateBytes: normalizeBytes(
              partial.offlineUnknownEpisodeEstimateBytes,
              DEFAULT_UNKNOWN_EPISODE_ESTIMATE_BYTES,
            ),
          }
        : null),
      ...(partial.offlineDefaultRunwayTarget !== undefined
        ? { offlineDefaultRunwayTarget: normalizeRunwayTarget(partial.offlineDefaultRunwayTarget) }
        : null),
      ...(partial.protectedDownloadJobIds !== undefined
        ? { protectedDownloadJobIds: normalizeStringList(partial.protectedDownloadJobIds) }
        : null),
      ...(partial.recoveryMode !== undefined
        ? { recoveryMode: normalizeRecoveryMode(partial.recoveryMode) }
        : null),
      ...(partial.continueSourcePreference !== undefined
        ? {
            continueSourcePreference: normalizeContinueSourcePreference(
              partial.continueSourcePreference,
            ),
          }
        : null),
      ...(partial.startupPriority !== undefined
        ? { startupPriority: normalizeStartupPriority(partial.startupPriority) }
        : null),
      ...(partial.mpvInProcessStreamReconnectMaxAttempts !== undefined
        ? {
            mpvInProcessStreamReconnectMaxAttempts: normalizeMpvReconnectAttempts(
              partial.mpvInProcessStreamReconnectMaxAttempts,
            ),
          }
        : null),
      ...(partial.videasySessionToken !== undefined
        ? { videasySessionToken: normalizeOptionalSecret(partial.videasySessionToken) }
        : null),
      ...(partial.providerRelay !== undefined
        ? { providerRelay: normalizeProviderRelayConfig(partial.providerRelay) }
        : null),
      ...(partial.videasySessionExpiresAt !== undefined
        ? {
            videasySessionExpiresAt: normalizeVideasySessionExpiresAt(
              partial.videasySessionExpiresAt,
            ),
          }
        : null),
      ...(partial.videasyAppId !== undefined
        ? {
            videasyAppId: normalizeVideasyAppId(
              partial.videasyAppId,
              partial.videasySessionToken !== undefined
                ? normalizeOptionalSecret(partial.videasySessionToken)
                : this.config.videasySessionToken,
            ),
          }
        : null),
      ...(partial.titleProviderPreferences !== undefined
        ? {
            titleProviderPreferences: normalizeTitleProviderPreferences(
              partial.titleProviderPreferences,
            ),
          }
        : null),
    };
  }

  private savePending: Promise<void> | null = null;
  private savePendingResolve: (() => void) | null = null;
  private savePendingReject: ((reason?: Error | string) => void) | null = null;
  /**
   * The store write started by a fired debounce, until it settles.
   *
   * `savePending` is cleared the moment the write starts, so it alone cannot
   * tell shutdown that a write is still running.
   */
  private saveInFlight: Promise<void> | null = null;

  // Trailing debounce: every call re-arms the timer so the latest config wins,
  // and all callers in a burst share one promise that settles once the write
  // actually lands (or rejects, so shutdown can record the failure).
  async save(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.savePending) {
      this.savePending = new Promise<void>((resolve, reject) => {
        this.savePendingResolve = resolve;
        this.savePendingReject = reject;
      });
    }
    this.saveTimer = setTimeout(() => {
      // The pending promise carries success/failure to every save() caller.
      this.persistPendingSave().catch(() => {});
    }, this.saveTimeoutMs);
    return this.savePending;
  }

  /** Persist any pending debounced save immediately (shutdown path). */
  async flushPending(): Promise<void> {
    if (this.savePending) {
      await this.persistPendingSave();
      return;
    }
    // A debounce that already fired cleared `savePending` while its store write
    // is still running. Returning here let shutdown reach `process.exit()`
    // under an in-flight write and truncate config.json.
    if (this.saveInFlight) await this.saveInFlight;
  }

  private persistPendingSave(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const pending = this.savePending;
    if (!pending) return Promise.resolve();
    const resolve = this.savePendingResolve;
    const reject = this.savePendingReject;
    this.savePending = null;
    this.savePendingResolve = null;
    this.savePendingReject = null;
    // Tracked *before* the write starts. `store.save()` throwing synchronously
    // runs the catch and the finally before this assignment would have happened,
    // so assigning afterwards left an already-rejected promise in `saveInFlight`
    // that every later `flushPending()` would await.
    this.saveInFlight = pending;
    void (async () => {
      try {
        await this.persistConfig();
        resolve?.();
      } catch (error) {
        reject?.(error instanceof Error ? error : String(error));
      } finally {
        if (this.saveInFlight === pending) this.saveInFlight = null;
      }
    })();
    return pending;
  }

  async reset(): Promise<void> {
    this.config = { ...DEFAULT_CONFIG };
    // Reset must write every key, not just session-dirty ones.
    // SAFETY: Object.keys of DEFAULT_CONFIG only yields KitsuneConfig keys.
    for (const key of Object.keys(DEFAULT_CONFIG) as (keyof KitsuneConfig)[]) {
      this.dirtyKeys.add(key);
    }
    await this.persistConfig();
  }
}

function normalizeStringList<T>(values: T): readonly string[] {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values
        .filter(isJsonString)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

function normalizeOptionalSecret<T>(value: T): string {
  return isJsonString(value) ? value.trim() : "";
}

function normalizeVideasySessionExpiresAt<T, U>(value: T, token?: U): number {
  const expiresAt = typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
  if (!normalizeOptionalSecret(token)) return 0;
  return isExpiredVideasySession(expiresAt) ? 0 : expiresAt;
}

function isExpiredVideasySession(expiresAt: number): boolean {
  return expiresAt > 0 && expiresAt <= Date.now();
}

const CURRENT_PROVIDER_DEFAULTS_REVISION = DEFAULT_CONFIG.providerDefaultsRevision ?? 0;

function readProviderDefaultsRevision(loaded: Partial<KitsuneConfig>): number {
  const value = loaded.providerDefaultsRevision;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Every anime-lane default a build may have written to disk, keyed by the
 * revision it was written under.
 *
 * `ConfigStore.save` writes the whole merged config, so a default sits on disk
 * for every user who ever saved any setting — and the file cannot tell it apart
 * from a deliberate choice. The exact pair *under the revision it shipped in* is
 * the closest honest signal: anyone who touched the anime lane has something else
 * there, and is left alone. Tying each pair to its revision is what keeps a
 * choice made after a migration: a user stamped with revision 1 who picks AniDB
 * again holds the revision-0 pair, which is only inherited at revision 0.
 * anidb.app answering 503 at the origin makes an inherited anidb pair an
 * outage, not a preference, so moving even a deliberate re-pick to the working
 * default is the honest outcome.
 */
const INHERITED_ANIME_DEFAULTS: readonly {
  readonly revision: number;
  readonly animeProvider: string;
  readonly priorities: readonly (readonly string[] | undefined)[];
}[] = [
  // AniDB alone, before revisions existed. A config older than the priority
  // list has none, and inherited the default by definition.
  {
    revision: 0,
    animeProvider: "anidb",
    priorities: [undefined, ["anidb"], ["anidb", "allanime"]],
  },
  // Revision 1 moved the lane to Miruro, and the list then grew twice in
  // stacked changes. Either list is on disk if a build shipped between them.
  {
    revision: 1,
    animeProvider: "miruro",
    priorities: [
      ["miruro", "anidb", "allanime"],
      ["miruro", "animegg", "anidb", "allanime"],
    ],
  },
  // Revision 2 kept Miruro and filled in the independent backends. On disk it
  // is the pair below; revision 3 moves the lane to HiAnime.
  {
    revision: 2,
    animeProvider: "miruro",
    priorities: [["miruro", "kickassanime", "animegg", "anidb", "allanime"]],
  },
];

function shouldMigrateInheritedAnimeDefaults(loaded: Partial<KitsuneConfig>): boolean {
  const revision = readProviderDefaultsRevision(loaded);
  if (revision >= CURRENT_PROVIDER_DEFAULTS_REVISION) return false;
  const priority = loaded.animeProviderPriority;
  return INHERITED_ANIME_DEFAULTS.some(
    (inherited) =>
      inherited.revision === revision &&
      loaded.animeProvider === inherited.animeProvider &&
      inherited.priorities.some((list) => sameProviderList(list, priority)),
  );
}

function sameProviderList(
  expected: readonly string[] | undefined,
  actual: readonly string[] | undefined,
): boolean {
  if (expected === undefined || actual === undefined) return expected === actual;
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    expected.every((id, index) => actual[index] === id)
  );
}

/**
 * The only movie/series priority list a released binary has written next to a
 * Videasy default.
 *
 * `api.videasy.to` no longer resolves at DNS — an inherited Videasy pair sits
 * on a degraded lane lead, not a preference. As with the anime twin, the
 * exact-pair match is the closest honest signal that the user never touched
 * the lane: a picker write
 * either reorders the priority or sets `provider` alone with the shipped list
 * intact. The vidking-era `provider` value normalizes to `videasy` here, so a
 * config old enough to carry the legacy id still counts as inherited.
 */
const SHIPPED_VIDEASY_DEFAULT_PRIORITIES: ReadonlyArray<readonly string[]> = [
  ["rivestream", "vidlink"],
];

/**
 * Configs stamped before `CURRENT_PROVIDER_DEFAULTS_REVISION` whose series pair
 * is exactly a pair a release once shipped are moved to `DEFAULT_CONFIG`'s
 * series defaults. Anything else — a reordered custom list or a non-Videasy
 * pick — is left alone. A user who re-picks Videasy after the migration writes
 * `provider` alone (or with a missing/unreadable priority), which this check
 * no longer matches.
 */
function shouldMigrateInheritedSeriesDefaults(loaded: Partial<KitsuneConfig>): boolean {
  if (readProviderDefaultsRevision(loaded) >= CURRENT_PROVIDER_DEFAULTS_REVISION) return false;
  const provider = isJsonString(loaded.provider) ? loaded.provider.trim() : "";
  if (migrateLegacyProviderId(provider) !== "videasy") return false;
  const priority = loaded.providerPriority;
  // A missing or unreadable priority cannot carry a deliberate ordering —
  // it normalizes to the shipped list below, so it must not shield the dead
  // provider pick from migration either.
  if (!Array.isArray(priority)) return true;
  return SHIPPED_VIDEASY_DEFAULT_PRIORITIES.some(
    (shipped) =>
      shipped.length === priority.length && shipped.every((id, index) => id === priority[index]),
  );
}

function shouldPersistVideasyAppIdMigration(
  loaded: Partial<KitsuneConfig>,
  normalized: KitsuneConfig,
): boolean {
  return (
    loaded.videasyAppId === "vidking" &&
    !normalizeOptionalSecret(loaded.videasySessionToken) &&
    normalized.videasyAppId === "bc-frontend"
  );
}

function normalizeVideasyAppId<T>(value: T, sessionToken = ""): KitsuneConfig["videasyAppId"] {
  const appId = typeof value === "string" ? value.trim() : "";
  if (appId === "bc-frontend") return "bc-frontend";
  // Legacy persisted default before Cineplay became primary. Without a paired vidking.net
  // session token, the vidking app id resolves embed-tier HLS that stalls in mpv.
  if (appId === "vidking" && normalizeOptionalSecret(sessionToken)) return "vidking";
  return "bc-frontend";
}

function normalizeRecoveryMode<T>(value: T): RecoveryMode {
  return value === "manual" ? "manual" : value === "fallback-first" ? "fallback-first" : "guided";
}

function normalizeContinueSourcePreference<T>(value: T): ContinueSourcePreference {
  return value === "local"
    ? "local"
    : value === "stream"
      ? "stream"
      : value === "ask"
        ? "ask"
        : "auto";
}

function normalizeAnalyticsPreference<T>(value: T): KitsuneConfig["analytics"] {
  return value === "enabled" ? "enabled" : value === "disabled" ? "disabled" : "unset";
}

function normalizeStartupPriority<T>(value: T): StartupPriority {
  return value === "fast" ? "fast" : value === "quality-first" ? "quality-first" : "balanced";
}

function normalizeBytes<T>(value: T, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.trunc(value));
}

function normalizeRunwayTarget<T>(value: T): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_OFFLINE_RUNWAY_TARGET;
  return Math.max(1, Math.min(24, Math.trunc(value)));
}

function normalizeMpvReconnectAttempts<T>(value: T): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return MPV_IN_PROCESS_RECONNECT_MAX_ATTEMPTS;
  }
  return Math.max(0, Math.min(MPV_IN_PROCESS_RECONNECT_MAX_ATTEMPTS, Math.trunc(value)));
}

function normalizeMaxConcurrentDownloads<T>(value: T): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 3;
  return Math.max(1, Math.min(5, Math.trunc(value)));
}

/** Host-only relay URL for debug logs: the full URL can carry path/query. */
function relayHostForDebug(baseUrl: string | undefined): string {
  if (!baseUrl) return "";
  try {
    return new URL(baseUrl).host;
  } catch {
    return "unparseable";
  }
}
