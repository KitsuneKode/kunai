import type { Container } from "@/container";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";

export type PersistTiming = "immediate" | "debounced";

export async function persistSettingsDraft(
  container: Container,
  next: KitsuneConfig,
  previous?: KitsuneConfig,
): Promise<void> {
  const before = previous ?? container.config.getRaw();
  const patch = settingsDraftPatch(next, before);
  if (Object.keys(patch).length === 0) return;
  const { applySettingsToRuntime } = await import("@/app/bootstrap/apply-settings-to-runtime");
  await applySettingsToRuntime({ container, next: patch });
}

export function shouldDebouncePersist(kind: string): boolean {
  return kind === "reorder";
}

/** A draft is a UI snapshot, never permission to overwrite every config key. */
export function settingsDraftPatch(
  next: KitsuneConfig,
  previous: KitsuneConfig,
): Partial<KitsuneConfig> {
  const patch: Partial<KitsuneConfig> = {};
  for (const key of Object.keys(next) as (keyof KitsuneConfig)[]) {
    if (key === "installId" || key === "analyticsRetryAfter" || key === "lastAnalyticsPingAt")
      continue;
    if (JSON.stringify(next[key]) !== JSON.stringify(previous[key])) {
      Object.assign(patch, { [key]: next[key] });
    }
  }
  return patch;
}

/** Serialize edits and action refreshes, retaining failed choices until saved or superseded. */
export function createSettingsDraftWriter(container: Container, initial: KitsuneConfig) {
  let submitted = initial;
  let pending: Partial<KitsuneConfig> = {};
  let tail = Promise.resolve();
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  async function flush() {
    if (Object.keys(pending).length === 0) return;
    const { applySettingsToRuntime } = await import("@/app/bootstrap/apply-settings-to-runtime");
    await applySettingsToRuntime({ container, next: pending });
    pending = {};
  }
  return {
    save(next: KitsuneConfig): Promise<void> {
      // Advance on the user's choice, even if disk rejects it. A later explicit
      // disable must supersede a failed enable rather than look like a no-op.
      const patch = settingsDraftPatch(next, submitted);
      submitted = next;
      return enqueue(async () => {
        pending = { ...pending, ...patch };
        await flush();
      });
    },
    action<T>(run: () => Promise<T>, refresh: (draft: KitsuneConfig) => void): Promise<T> {
      return enqueue(async () => {
        await flush();
        const result = await run();
        submitted = container.config.getRaw();
        refresh(submitted);
        return result;
      });
    },
  };
}
