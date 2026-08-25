// =============================================================================
// pre-setup-snapshot.ts — one restore point, taken before setup rewrites config
//
// A setup rerun rewrites preferences, sync toggles, and all four language lanes
// in a single commit. #228 was exactly that going wrong: a rerun severed linked
// trackers because every control started from a factory default rather than
// from what was configured. That cause is fixed; this is the net under the next
// one.
//
// The only backup that existed before this was `FileStorage`'s `.corrupt.bak`,
// which fires on unparseable JSON. A valid-but-unwanted rewrite had no recovery
// at all — the file was perfectly well-formed, and perfectly wrong.
// =============================================================================

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { writeAtomicSecretJson } from "@/infra/fs/atomic-write";
import { getKunaiPaths } from "@/services/storage/storage-read-models";
import type { KitsuneConfig } from "@kunai/config";

/**
 * The fields whose loss a user would actually notice.
 *
 * A snapshot on every setup run is noise: the restore point people want is
 * "before I resetup", not "before every keystroke". Setup always writes
 * `onboardingVersion` and `downloadOnboardingDismissed`, so those are
 * deliberately absent — they change on every run and mean nothing to anyone.
 *
 * `analytics` and `installId` are absent for a different reason: consent already
 * has its own screen, its own `/settings` switch, and its own contract. An
 * analytics-only change is a decision the user just made on purpose, not
 * something they need protecting from.
 */
export const RESTORABLE_SETUP_FIELDS = [
  "sync",
  "animeLanguageProfile",
  "seriesLanguageProfile",
  "movieLanguageProfile",
  "youtubeLanguageProfile",
  "defaultMode",
  "downloadsEnabled",
  "defaultDownloadQuality",
  "downloadPath",
  "presenceProvider",
  "autoNext",
  "skipIntro",
  "skipCredits",
] as const satisfies readonly (keyof KitsuneConfig)[];

/**
 * Sibling of `config.json`, and exactly one of them.
 *
 * A growing history is a maintenance burden nobody asked for — and a directory
 * of timestamped configs is harder to reason about than one file whose name
 * says when it was taken.
 */
export function preSetupSnapshotPath(): string {
  return `${getKunaiPaths().configPath}.pre-setup.bak`;
}

export function preSetupSnapshotExists(): boolean {
  return existsSync(preSetupSnapshotPath());
}

/**
 * Whether this setup run is about to change something worth being able to undo.
 *
 * Compares the patch against the config it will be applied to, so a run the
 * user clicked straight through — every control hydrated, nothing moved — takes
 * no snapshot and leaves an older, more useful restore point standing.
 */
export function setupPatchIsRestorable(
  current: KitsuneConfig,
  patch: Partial<KitsuneConfig>,
): boolean {
  return RESTORABLE_SETUP_FIELDS.some(
    (field) => field in patch && JSON.stringify(patch[field]) !== JSON.stringify(current[field]),
  );
}

/**
 * Take the snapshot. Returns whether it landed.
 *
 * `writeAtomicSecretJson` is the same 0600 + fsync + atomic-rename path config
 * itself uses, so a crash mid-snapshot cannot leave a torn file next to a good
 * config. Never throws: the user's setup completing matters more than the
 * backup, and a failure here must not become a failure there.
 */
export async function writePreSetupSnapshot(config: KitsuneConfig): Promise<boolean> {
  try {
    await writeAtomicSecretJson(preSetupSnapshotPath(), config);
    return true;
  } catch {
    return false;
  }
}

/** Read the snapshot back, or `null` when there is none or it is unreadable. */
export async function readPreSetupSnapshot(): Promise<Partial<KitsuneConfig> | null> {
  try {
    const raw = await readFile(preSetupSnapshotPath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Partial<KitsuneConfig>;
  } catch {
    return null;
  }
}
