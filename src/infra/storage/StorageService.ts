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
}
