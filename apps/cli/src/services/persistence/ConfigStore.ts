// =============================================================================
// Config Store
//
// Low-level config persistence (file-based).
// =============================================================================

export type { KitsuneConfig } from "./ConfigService";
import type { KitsuneConfig } from "./ConfigService";

export { DEFAULT_CONFIG } from "@kunai/config";

export interface ConfigStore {
  load(): Promise<Partial<KitsuneConfig>>;
  save(config: KitsuneConfig): Promise<void>;
  reset(): Promise<void>;
  /**
   * Serialize a read→merge→write cycle across processes sharing the file.
   * Optional — stores without a real file backend run `fn` directly.
   */
  withLock?<T>(fn: () => Promise<T>): Promise<T>;
}
