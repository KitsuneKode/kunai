/**
 * Storage read-models and helpers for app-shell consumers.
 * App-shell must import from here instead of @kunai/storage directly.
 */
export {
  getKunaiPaths,
  historyProgressToInput,
  type DownloadJobRecord,
  type HistoryProgress,
  type HistoryRepository,
  type ListItem,
  type NotificationRecord,
  type QueueEntry,
  type ReleaseProgressCacheRepository,
  type ReleaseProgressDiagnosticsSummary,
  type ReleaseProgressProjection,
} from "@kunai/storage";
