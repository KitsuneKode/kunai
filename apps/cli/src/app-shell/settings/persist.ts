import type { Container } from "@/container";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";

import { settingsEqual } from "./settings-equal";

export type PersistTiming = "immediate" | "debounced";

export async function persistSettingsDraft(
  container: Container,
  next: KitsuneConfig,
  previous?: KitsuneConfig,
): Promise<void> {
  const before = previous ?? container.config.getRaw();
  if (settingsEqual(next, before)) return;
  const { applySettingsToRuntime } = await import("@/app/bootstrap/apply-settings-to-runtime");
  await applySettingsToRuntime({ container, next, previous: before });
}

export function shouldDebouncePersist(kind: string): boolean {
  return kind === "reorder";
}
