// =============================================================================
// Storage Service Interface
//
// Abstracts file system operations for persistence.
// =============================================================================

export interface StorageService {
  read<T>(key: string): Promise<T | null>;
  write<T>(key: string, data: T): Promise<void>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /**
   * Serialize a read→merge→write cycle across processes sharing the file.
   * The in-process write lock only orders this instance's writes; concurrent
   * `kunai` instances each hold their own service, so an on-disk claim is
   * what makes the cycle exclusive. Optional: stores without a file backend
   * simply run `fn`.
   */
  withLock?<T>(key: string, fn: () => Promise<T>): Promise<T>;
}
