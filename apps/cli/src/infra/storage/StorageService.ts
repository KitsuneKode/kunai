// =============================================================================
// Storage Service Interface
//
// Abstracts file system operations for persistence.
// =============================================================================

export interface StorageService {
  read<T>(key: string): Promise<T | null>;
  write<T>(key: string, data: T): Promise<void>;
  /**
   * Read and write one key under the in-process mutex and a lock file, so two
   * processes cannot each save a stale full object.
   */
  mutate<T extends Record<string, unknown>>(
    key: string,
    update: (current: T | null) => T,
  ): Promise<void>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
