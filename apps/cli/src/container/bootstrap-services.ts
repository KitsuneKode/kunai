import { existsSync } from "node:fs";

import { ActivePlaybackCheckpoint } from "@/services/continuation/active-playback-checkpoint";

import { isInteractiveShellMounted } from "../app-shell/interactive-shell-state";
import { SessionStateManagerImpl } from "../domain/session/SessionStateManager";
import type { PlayerPresentationPort } from "../infra/player/player-presentation-port";
import { PlayerControlServiceImpl } from "../infra/player/PlayerControlServiceImpl";
import { PlayerServiceImpl } from "../infra/player/PlayerServiceImpl";
import { ShellServiceImpl } from "../infra/shell/ShellServiceImpl";
import { WorkControlServiceImpl } from "../infra/work/WorkControlServiceImpl";
import { AttentionRefreshWorker } from "../services/attention/AttentionRefreshWorker";
import { createProviderAvailabilityRefresh } from "../services/attention/provider-availability-refresh";
import { BackgroundWorkScheduler } from "../services/background/BackgroundWorkScheduler";
import { fetchArmIdGraph } from "../services/catalog/arm-client";
import { CatalogIdentityService } from "../services/catalog/CatalogIdentityService";
import { createCatalogScheduleService } from "../services/catalog/CatalogScheduleService";
import { ResultEnrichmentService } from "../services/catalog/ResultEnrichmentService";
import { TimelineService } from "../services/catalog/TimelineService";
import { ContinuationProjectionService } from "../services/continuation/ContinuationProjectionService";
import { ContinueWatchingService } from "../services/continuation/ContinueWatchingService";
import { DownloadService } from "../services/download/DownloadService";
import { createHistoryMetadataResolver } from "../services/history-metadata/create-history-metadata-resolver";
import { HistoryMetadataHealer } from "../services/history-metadata/HistoryMetadataHealer";
import { Connectivity } from "../services/network/Connectivity";
import {
  mapRecordToSinkDelivery,
  NotificationSinkRegistry,
} from "../services/notifications/notification-sink";
import {
  LogNotificationSink,
  OsNotificationSink,
} from "../services/notifications/notification-sinks";
import { NotificationService } from "../services/notifications/NotificationService";
import { OfflineAssetService } from "../services/offline/OfflineAssetService";
import { OfflineLibraryService } from "../services/offline/OfflineLibraryService";
import { OfflineMaintenanceService } from "../services/offline/OfflineMaintenanceService";
import { OfflineRunwayService } from "../services/offline/OfflineRunwayService";
import { DurablePlaylistService } from "../services/playlists/DurablePlaylistService";
import { PresenceServiceImpl } from "../services/presence/PresenceServiceImpl";
import { RecommendationServiceImpl } from "../services/recommendations/RecommendationServiceImpl";
import { loadCatalogProgress } from "../services/release-reconciliation/catalog-progress";
import { ReleaseProgressWriter } from "../services/release-reconciliation/ReleaseProgressWriter";
import { ReleaseReconciliationService } from "../services/release-reconciliation/ReleaseReconciliationService";
import { SEARCH_SERVICE_DEFINITIONS } from "../services/search/definitions";
import { SearchRegistryImpl } from "../services/search/SearchRegistry";
import { searchTitles } from "../services/search/SearchRoutingService";
import { BinaryAutoUpdater } from "../services/update/BinaryAutoUpdater";
import { readInstallManifest } from "../services/update/install-manifest";
import { detectInstallMethod } from "../services/update/install-method";
import { resolveLatestVersion } from "../services/update/resolve-latest-version";
import { UpdateService } from "../services/update/UpdateService";
import type { PersistenceBootstrap } from "./bootstrap-persistence";
import type { ProviderBootstrap } from "./bootstrap-providers";
import type { ContainerDisposeHandles } from "./dispose-container";
import type { Container, ContainerOptions } from "./types";

export type ServicesBootstrap = Omit<
  Container,
  | "logger"
  | "tracer"
  | "sessionId"
  | "config"
  | "engine"
  | "providerRegistry"
  | "playbackResolveWork"
>;

export function bootstrapServices(input: {
  readonly options?: ContainerOptions;
  readonly persistence: PersistenceBootstrap;
  readonly providers: ProviderBootstrap;
  readonly disposeHandles: ContainerDisposeHandles;
}): ServicesBootstrap {
  const { options, persistence, providers, disposeHandles } = input;
  const { logger, tracer, sessionId } = persistence.core;
  const { engine: _engine, providerRegistry, playbackResolveWork } = providers;
  const {
    config,
    diagnosticsService,
    historyRepository,
    playbackEventRepository,
    downloadJobs,
    offlineAssets,
    offlineTitlePolicies,
    offlineMaintenanceJobs,
    listRepository,
    queueRepository,
    notificationRepository,
    followedTitleRepository,
    playlistsRepository,
    featureFlags,
    providerHealth,
    endpointHealth,
    titleProviderHealth,
    recommendationCache,
    scheduleCache,
    releaseProgressCache,
    calendarArchive,
    storage,
    configStore,
    cacheStore,
    diagnosticsStore,
    storageMaintenance,
    sourceInventory,
    episodePlaybackSelection,
    titlePlaybackSource,
    videasyLazySourceProbe,
    mediaTrackService,
    listService,
    queueService,
    statsService,
    statsFormatter,
    syncTokenStore,
    syncService,
    debugTracePath,
    debugSessionInstructions,
  } = persistence;

  const stateManager = new SessionStateManagerImpl({ logger });
  const shell = new ShellServiceImpl({ logger, tracer, stateManager });
  const playerControl = new PlayerControlServiceImpl({ logger, diagnostics: diagnosticsService });
  const workControl = new WorkControlServiceImpl({ logger, diagnostics: diagnosticsService });
  const playerPresentation: PlayerPresentationPort = {
    isInteractiveShellMounted,
  };
  const player = new PlayerServiceImpl({
    logger,
    tracer,
    diagnostics: diagnosticsService,
    playerControl,
    config,
    mpv: options?.mpv,
    presentation: playerPresentation,
  });
  const presence = new PresenceServiceImpl({ config, diagnostics: diagnosticsService });

  const offlineAssetService = new OfflineAssetService(offlineAssets);
  const connectivity = new Connectivity(() => config.offlineMode);
  const notificationSinkRegistry = new NotificationSinkRegistry();
  notificationSinkRegistry.register(
    new LogNotificationSink((message, context) => {
      logger.debug(message, context);
    }),
  );
  notificationSinkRegistry.register(new OsNotificationSink());
  const notificationService = new NotificationService({
    repo: notificationRepository,
    getMutedTitleIds: () =>
      new Set(followedTitleRepository.listByPreference("muted").map((item) => item.titleId)),
    derivationFlags: {
      newEpisodeProjection: featureFlags.newEpisodeProjection,
      queueRecovery: featureFlags.queueRecovery,
    },
    sinks: {
      deliverActive: (records) => {
        for (const record of records) {
          notificationSinkRegistry.deliver(mapRecordToSinkDelivery(record));
        }
      },
      dismiss: (dedupKey) => {
        notificationSinkRegistry.dismiss(dedupKey);
      },
    },
  });

  const downloadService = new DownloadService({
    repo: downloadJobs,
    config,
    logger,
    ytDlpAvailable: options?.capabilitySnapshot?.ytDlp ?? false,
    ffprobeAvailable: Boolean(Bun.which("ffprobe")),
    diagnostics: diagnosticsService,
    onCompletedArtifact: (job) => {
      const asset = offlineAssetService.adoptCompletedJob(job);
      if (asset?.state !== "ready") return;
      notificationService.recordSignals(
        [
          {
            type: "download-complete",
            titleId: asset.titleId,
            mediaKind: asset.mediaKind,
            title: asset.titleName,
            season: asset.season,
            episode: asset.episode,
          },
        ],
        asset.updatedAt,
      );
    },
    onTerminalFailure: (job, error) => {
      notificationService.recordSignals([
        {
          type: "download-failed",
          titleId: job.titleId,
          mediaKind: job.mediaKind,
          title: job.titleName,
          season: job.season,
          episode: job.episode,
          error,
        },
      ]);
    },
    resolveDownloadStream: async (intent) => {
      const controller = new AbortController();
      disposeHandles.downloadResolveAbort = controller;
      try {
        const result = await playbackResolveWork.resolve(
          {
            title: intent.title,
            episode: intent.episode ?? { season: 1, episode: 1 },
            mode: intent.mode,
            providerId: intent.providerId,
            audioPreference: intent.audioPreference,
            subtitlePreference: intent.subtitlePreference,
            qualityPreference: intent.qualityPreference,
            startupPriority: "quality-first",
            selectedSourceId: intent.selectedSourceId,
            selectedStreamId: intent.selectedStreamId,
            favoriteSourceNames: config.favoriteSources,
            recoveryMode: config.recoveryMode,
            signal: controller.signal,
          },
          { intentKind: "download", budgetLane: "background" },
        );
        if (!result.stream) return null;
        const resolvedStreamId = result.stream.providerResolveResult?.selectedStreamId;
        const resolvedSourceId = result.stream.providerResolveResult?.streams.find(
          (candidate) => candidate.id === resolvedStreamId,
        )?.sourceId;
        return {
          stream: result.stream,
          providerId: result.providerId,
          selectionChanged:
            result.providerId !== intent.providerId ||
            (Boolean(intent.selectedStreamId) && resolvedStreamId !== intent.selectedStreamId) ||
            (Boolean(intent.selectedSourceId) && resolvedSourceId !== intent.selectedSourceId),
        };
      } finally {
        if (disposeHandles.downloadResolveAbort === controller) {
          disposeHandles.downloadResolveAbort = null;
        }
      }
    },
  });
  const offlineLibraryService = new OfflineLibraryService({
    downloadService,
    historyRepository,
    offlineAssetService,
  });
  const offlineMaintenanceService = new OfflineMaintenanceService({
    jobs: offlineMaintenanceJobs,
    assets: offlineAssetService,
    diagnostics: diagnosticsService,
  });
  const startupAt = new Date().toISOString();
  queueRepository.markActiveQueueSessionsRecoverable(sessionId, startupAt);
  queueRepository.createQueueSession({
    id: sessionId,
    status: "active",
    createdAt: startupAt,
    updatedAt: startupAt,
  });
  notificationService.deleteByKind("queue-recovery");
  const latestRecoverableSession = queueRepository.listRecoverableQueueSessions()[0];
  if (latestRecoverableSession) {
    notificationService.recordSignals(
      [
        {
          type: "queue-recoverable" as const,
          queueSessionId: latestRecoverableSession.id,
          itemCount: latestRecoverableSession.itemCount,
          updatedAt: latestRecoverableSession.updatedAt,
        },
      ],
      startupAt,
    );
  }
  const continuationProjectionService = new ContinuationProjectionService();
  const continueWatchingService = new ContinueWatchingService(historyRepository);
  const attentionRefreshWorker = new AttentionRefreshWorker({
    flags: featureFlags,
    diagnostics: diagnosticsService,
    refreshAvailability: featureFlags.providerAvailabilitySync
      ? createProviderAvailabilityRefresh({
          playbackResolveWork,
          releaseProgressCache,
          historyRepository,
          diagnostics: diagnosticsService,
          getMode: () => stateManager.getState().mode,
          getProviderId: () => stateManager.getState().provider,
          getAudioPreference: () =>
            stateManager.getState().mode === "anime"
              ? stateManager.getState().animeLanguageProfile.audio
              : stateManager.getState().seriesLanguageProfile.audio,
          getSubtitlePreference: () =>
            stateManager.getState().mode === "anime"
              ? stateManager.getState().animeLanguageProfile.subtitle
              : stateManager.getState().seriesLanguageProfile.subtitle,
        })
      : undefined,
  });
  const backgroundWorkScheduler = new BackgroundWorkScheduler({
    maxConcurrent: 2,
    diagnostics: diagnosticsService,
  });
  const durablePlaylistService = new DurablePlaylistService(playlistsRepository);
  const searchRegistry = new SearchRegistryImpl({ logger, tracer }, SEARCH_SERVICE_DEFINITIONS);
  const shellChrome = options?.shellChrome ?? "default";
  const capabilitySnapshot = options?.capabilitySnapshot ?? null;
  const recommendationService = new RecommendationServiceImpl(recommendationCache);
  const catalogScheduleService = createCatalogScheduleService(scheduleCache);
  const releaseProgressWriter = new ReleaseProgressWriter(releaseProgressCache);
  const releaseReconciliationService = new ReleaseReconciliationService({
    repository: releaseProgressCache,
    writer: releaseProgressWriter,
    loadProgress: (candidates, signal) =>
      loadCatalogProgress(catalogScheduleService, candidates, signal),
  });
  const offlineRunwayService = new OfflineRunwayService({
    policies: offlineTitlePolicies,
    assets: offlineAssetService,
    historyRepository,
    releaseProgressCache,
    downloadService,
    scheduler: backgroundWorkScheduler,
    diagnostics: diagnosticsService,
    isPowerSaver: () => config.powerSaverMode,
  });
  const activePlaybackCheckpoint = new ActivePlaybackCheckpoint();
  const timelineService = new TimelineService(catalogScheduleService);
  const resultEnrichmentService = new ResultEnrichmentService({
    historyRepository,
    offlineLibraryService,
    continueWatchingService,
    getCachedNextRelease: (result) =>
      result.id.startsWith("anilist:")
        ? catalogScheduleService.peekNextRelease("anilist", result.id)
        : null,
    ttlMs: 5 * 60 * 1000,
  });
  const catalogIdentityService = new CatalogIdentityService({
    arm: { fetchIds: fetchArmIdGraph },
    cache: persistence.catalogCrosswalk,
  });
  const historyCatalogEpisodeCounts = new Map<string, number>();
  const historyMetadataHealer = new HistoryMetadataHealer({
    repo: historyRepository,
    resolver: createHistoryMetadataResolver({
      search: async (title, mediaKind) => {
        const mode = mediaKind === "anime" ? "anime" : mediaKind === "video" ? "youtube" : "series";
        try {
          const { results } = await searchTitles(title, {
            mode,
            providerId:
              mode === "anime"
                ? config.animeProvider
                : mode === "youtube"
                  ? config.youtubeProvider
                  : config.provider,
            animeLanguageProfile: config.animeLanguageProfile,
            youtubeLanguageProfile: config.youtubeLanguageProfile,
            searchRegistry,
            providerRegistry,
            enrichAnimeMetadata: false,
          });
          return results;
        } catch (error) {
          logger.warn("History metadata search failed", { title, error });
          return [];
        }
      },
    }),
    onHealError: (titleId, error) =>
      logger.warn("History metadata heal failed", { titleId, error }),
  });
  const detectedInstall = detectInstallMethod({
    cwd: process.cwd(),
    entrypoint: process.argv[1],
    fileExists: existsSync,
  });
  const updateService = new UpdateService({
    config,
    diagnostics: diagnosticsService,
    currentVersion: options?.appVersion ?? "0.0.0",
    installMethod: detectedInstall,
    fetchLatestVersion: async () => {
      const manifest = await readInstallManifest();
      const channel = manifest?.channel ?? detectedInstall.kind;
      const version = await resolveLatestVersion(channel);
      if (!version) throw new Error("Could not resolve latest version");
      return version;
    },
  });
  const binaryAutoUpdater = new BinaryAutoUpdater({
    config,
    currentVersion: options?.appVersion ?? "0.0.0",
  });

  return {
    dataDir: persistence.paths.dataDir,
    shell,
    player,
    playerControl,
    workControl,
    storage,
    historyRepository,
    playbackEventRepository,
    configStore,
    cacheStore,
    dataDb: persistence.dataDb,
    cacheDb: persistence.cacheDb,
    diagnosticsStore,
    diagnosticsService,
    storageMaintenance,
    sourceInventory,
    episodePlaybackSelection,
    titlePlaybackSource,
    videasyLazySourceProbe,
    mediaTrackService,
    featureFlags,
    providerHealth,
    endpointHealth,
    titleProviderHealth,
    downloadService,
    offlineAssetService,
    offlineTitlePolicies,
    offlineMaintenanceJobs,
    offlineLibraryService,
    offlineMaintenanceService,
    offlineRunwayService,
    notificationService,
    connectivity,
    presence,
    stateManager,
    recommendationService,
    catalogScheduleService,
    releaseProgressCache,
    releaseProgressWriter,
    calendarArchive,
    releaseReconciliationService,
    timelineService,
    resultEnrichmentService,
    catalogIdentityService,
    historyMetadataHealer,
    historyCatalogEpisodeCounts,
    updateService,
    binaryAutoUpdater,
    listRepository,
    queueRepository,
    notificationRepository,
    followedTitleRepository,
    playlistsRepository,
    durablePlaylistService,
    listService,
    queueService,
    statsService,
    statsFormatter,
    syncTokenStore,
    syncService,
    continuationProjectionService,
    continueWatchingService,
    attentionRefreshWorker,
    backgroundWorkScheduler,
    activePlaybackCheckpoint,
    searchRegistry,
    shellChrome,
    capabilitySnapshot,
    debugTracePath,
    debugSessionInstructions,
  };
}
