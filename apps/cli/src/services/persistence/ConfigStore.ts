// =============================================================================
// Config Store
//
// Low-level config persistence (file-based).
// =============================================================================

export type { KitsuneConfig } from "./ConfigService";
import type { StremioAddonsConsent } from "@/domain/provider/stremio-addons";

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
  /**
   * Synchronous peek at the two Stremio addon consent keys in the live file.
   * Optional — stores without a synchronous read leave it unimplemented and
   * the service falls back to its in-memory value.
   */
  readStremioAddonsConsent?(): StremioAddonsConsent;
}
