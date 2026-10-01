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
  /**
   * Re-read the file and overlay only these keys. A second process that saved
   * other keys keeps them. Missing file starts from an empty object.
   */
  merge(patch: Partial<KitsuneConfig>): Promise<void>;
  reset(): Promise<void>;
}
