// =============================================================================
// File Storage Implementation
//
// JSON file persistence.
// =============================================================================

import type { StorageService } from "../storage/StorageService";

export class FileStorage implements StorageService {
  private data = new Map<string, unknown>();
  
  async read<T>(key: string): Promise<T | null> {
    return (this.data.get(key) as T) ?? null;
  }
  
  async write<T>(key: string, data: T): Promise<void> {
    this.data.set(key, data);
  }
  
  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
  
  async exists(key: string): Promise<boolean> {
    return this.data.has(key);
  }
}
