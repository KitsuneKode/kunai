export { createStreamCacheKey, stableKey } from "./cache-key";
export type { StreamCacheKeyInput } from "./cache-key";
export { cacheMigrations, dataMigrations, runMigrations } from "./migrations";
export type { Migration, MigrationDatabase } from "./migrations";
export {
  isDataMigrationApplied,
  isHistoryIdentityConsolidatorApplied,
  markDataMigrationApplied,
  markHistoryIdentityConsolidatorApplied,
} from "./migrations";
export { runDatabaseMaintenance } from "./maintenance";
export type {
  CacheMaintenancePruneCounts,
  DatabaseMaintenanceOptions,
  DatabaseMaintenanceResult,
  MaintenanceDatabaseKind,
} from "./maintenance";
export { getKunaiPaths } from "./paths";
export type { KunaiPathOptions, KunaiPaths, StoragePlatform } from "./paths";
export { openKunaiDatabase } from "./sqlite";
export type { KunaiDatabase, OpenDatabaseOptions } from "./sqlite";
export { defaultTtlMsByClass, getDefaultTtlMs, getExpiresAt, isExpired } from "./ttl";
export {
  createHistoryKey,
  historyProgressToInput,
  HistoryRepository,
} from "./repositories/history";
export type { HistoryProgress, HistoryProgressInput } from "./repositories/history";
export { DownloadJobsRepository } from "./repositories/download-jobs";
export type {
  DownloadArtifactStatus,
  DownloadJobRecord,
  DownloadJobStatus,
} from "./repositories/download-jobs";
export {
  createOfflineAssetIdentityKey,
  OfflineAssetsRepository,
} from "./repositories/offline-assets";
export type {
  OfflineAssetArtworkRecord,
  OfflineAssetInput,
  OfflineNextReadyCursor,
  OfflineAssetRecord,
  OfflineAssetSidecarState,
  OfflineAssetState,
  OfflineAssetTrackKind,
  OfflineAssetTrackRecord,
} from "./repositories/offline-assets";
export { OfflineTitlePoliciesRepository } from "./repositories/offline-title-policies";
export type { OfflineTitlePolicyRecord } from "./repositories/offline-title-policies";
export { OfflineMaintenanceJobsRepository } from "./repositories/offline-maintenance-jobs";
export type {
  OfflineMaintenanceJobRecord,
  OfflineMaintenanceOperation,
  OfflineMaintenanceStatus,
} from "./repositories/offline-maintenance-jobs";
export { ProviderHealthRepository } from "./repositories/provider-health";
export { ProviderEndpointHealthRepository } from "./repositories/provider-endpoint-health";
export { TitleProviderHealthRepository } from "./repositories/title-provider-health";
export type { TitleProviderHealthRecord } from "./repositories/title-provider-health";
export { ResolveTraceRepository } from "./repositories/resolve-trace";
export { RecommendationCacheRepository } from "./repositories/recommendation-cache";
export { ReleaseProgressCacheRepository } from "./repositories/release-progress-cache";
export type {
  ReleaseNewSeason,
  ReleaseProgressProjection,
  ReleaseProgressSource,
  ReleaseProgressStatus,
  ReleaseProgressSummary,
  ReleaseProgressDiagnosticsSummary,
} from "./repositories/release-progress-cache";
export { ProviderTitleBridgeRepository } from "./repositories/provider-title-bridge";
export { ScheduleCacheRepository } from "./repositories/schedule-cache";
export type { ScheduleCacheEntry, ScheduleCacheSetOptions } from "./repositories/schedule-cache";
export { CalendarArchiveRepository } from "./repositories/calendar-archive";
export type { CalendarArchiveItemInput } from "./repositories/calendar-archive";
export { SourceInventoryRepository } from "./repositories/source-inventory";
export type { SourceInventoryEntry } from "./repositories/source-inventory";
export { StreamCacheRepository } from "./repositories/stream-cache";
export type { StreamCacheEntry } from "./repositories/stream-cache";
export { ListRepository } from "./repositories/lists";
export type { KunaiList, ListItem, ListItemInput, ListKind } from "./repositories/lists";
export { QueueRepository } from "./repositories/queue";
export type {
  QueueEntry,
  QueueEntryInput,
  QueueItemStatus,
  QueueSessionInput,
  QueueSessionRecord,
  QueueSessionStatus,
} from "./repositories/queue";
export { NotificationRepository } from "./repositories/notifications";
export type { NotificationInput, NotificationRecord } from "./repositories/notifications";
export { FollowedTitleRepository } from "./repositories/followed-titles";
export type { FollowedTitlePreference, FollowedTitleRecord } from "./repositories/followed-titles";
export { PlaylistsRepository } from "./repositories/playlists";
export type { UserPlaylistItemRecord, UserPlaylistRecord } from "./repositories/playlists";
