import type { Container } from "@/container";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";

export type PersistTiming = "immediate" | "debounced";

/**
 * Persist the fields a draft changed relative to `previous`, never the draft
 * itself. `previous` is required: a stale full-config snapshot diffed against
 * the live config would write back every key another writer moved since.
 */
export async function persistSettingsDraft(
  container: Container,
  next: KitsuneConfig,
  previous: KitsuneConfig,
): Promise<void> {
  const patch = settingsDraftPatch(next, previous);
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
  // SAFETY: both snapshots are KitsuneConfig; their own enumerable keys are config fields.
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)] as (keyof KitsuneConfig)[]);
  for (const key of keys) {
    if (JSON.stringify(next[key]) !== JSON.stringify(previous[key])) {
      Object.assign(patch, { [key]: next[key] });
    }
  }
  return patch;
}

/**
 * Serialize Settings edits and action refreshes into targeted config patches.
 *
 * `pending` is the user's not-yet-persisted intent, merged synchronously so an
 * action's refresh can rebase onto edits made while it ran. A failed write
 * keeps its keys: a failed withdrawal must still reach disk on the next save,
 * and a later explicit choice for the same key supersedes it.
 */
export function createSettingsDraftWriter(container: Container, initial: KitsuneConfig) {
  let submitted = initial;
  let pending: Partial<KitsuneConfig> = {};
  let revision = 0;
  const revisions = new Map<keyof KitsuneConfig, number>();
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
    const batch = pending;
    if (Object.keys(batch).length === 0) return;
    const batchRevisions = new Map(revisions);
    const { applySettingsToRuntime } = await import("@/app/bootstrap/apply-settings-to-runtime");
    await applySettingsToRuntime({ container, next: batch });
    // A key edited again while the write ran keeps its newer value.
    // SAFETY: batch contains only fields returned by settingsDraftPatch.
    for (const key of Object.keys(batch) as (keyof KitsuneConfig)[]) {
      if (revisions.get(key) === batchRevisions.get(key)) {
        delete pending[key];
        revisions.delete(key);
      }
    }
  }
  return {
    save(next: KitsuneConfig): Promise<void> {
      // Advance on the user's choice, even if disk rejects it. A later explicit
      // disable must supersede a failed enable rather than look like a no-op.
      const patch = settingsDraftPatch(next, submitted);
      // SAFETY: settingsDraftPatch only copies keys from KitsuneConfig snapshots.
      for (const key of Object.keys(patch) as (keyof KitsuneConfig)[]) {
        revisions.set(key, ++revision);
      }
      pending = { ...pending, ...patch };
      submitted = next;
      return enqueue(flush);
    },
    /** Run `run` after earlier writes, then hand `refresh` the rebased draft. */
    action<T>(run: () => Promise<T>, refresh: (draft: KitsuneConfig) => void): Promise<T> {
      return enqueue(async () => {
        await flush();
        try {
          return await run();
        } finally {
          // The action may have moved config the draft cannot see, whether it
          // finished, failed or was cancelled. Edits queued behind it stay.
          submitted = { ...container.config.getRaw(), ...pending };
          refresh(submitted);
        }
      });
    },
  };
}
