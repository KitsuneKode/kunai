import { DEFAULT_CONFIG, type StremioAddonConfigEntry } from "@kunai/config";
import {
  parseStremioAddonUrl,
  scrubStremioAddonText,
  stremioAddonDisplayLabel,
  stremioAddonHasPrivateConfiguration,
  toDisplayText,
  type StremioAddonRef,
} from "@kunai/providers/stremio-addon";
import { isJsonObject, isJsonString, type LooseJsonValue } from "@kunai/types";

/**
 * Most addons one install may hold. Every installed addon is one more source
 * the fallback walk may ask, so the bound keeps a resolve's worst case finite.
 */
export const MAX_STREMIO_ADDONS = 12;

const MAX_ADDON_NAME_LENGTH = 60;

/** A configured addon together with what its URL says about it. */
export interface InstalledStremioAddon extends StremioAddonRef {
  /** The addon's own name when it is known, else its host. */
  readonly displayName: string;
  /** The entry as it is stored. */
  readonly entry: StremioAddonConfigEntry;
}

/**
 * One entry of the addon list as `config.json` may hold it. The file is
 * hand-editable, so an entry is any JSON at all until it has been read.
 */
type StoredStremioAddonEntry = LooseJsonValue | StremioAddonConfigEntry;

/** The addon list as `config.json` may hold it: the typed list, or whatever a hand edit left there. */
export type StoredStremioAddons = LooseJsonValue | readonly StremioAddonConfigEntry[];

/**
 * An addon's name as it may be shown: one line of printable text. It comes
 * from a server the user does not control and lands in pickers and footers.
 */
export function cleanStremioAddonName(
  value: string | null | undefined,
  manifestUrl?: string,
): string | undefined {
  // A configured URL's secrets can take forms a scrubber cannot recognise, so
  // a stored or freshly reported name for one is never trusted at all.
  if (manifestUrl && stremioAddonHasPrivateConfiguration(manifestUrl)) return undefined;
  // Names stored before the scrub existed can still echo the URL's secret
  // path, so the stored URL's own secrets are removed on every read.
  return toDisplayText(
    manifestUrl ? scrubStremioAddonText(value, manifestUrl) : value,
    MAX_ADDON_NAME_LENGTH,
  );
}

/**
 * What one stored entry says: a bare URL, or an object with a text `url` and
 * perhaps a text `name`. Anything else names no addon.
 */
function readStoredEntry(raw: StoredStremioAddonEntry): StremioAddonConfigEntry | undefined {
  if (isJsonString(raw)) return { url: raw };
  if (!isJsonObject(raw) || !isJsonString(raw.url)) return undefined;
  return isJsonString(raw.name) ? { url: raw.url, name: raw.name } : { url: raw.url };
}

/**
 * The addons a stored value really describes.
 *
 * `config.json` is hand-editable, so every entry is re-read through the same
 * URL parser the add path uses: an entry that is not a public
 * `https://…/manifest.json` address is dropped, and a URL listed twice is kept
 * once. Nothing is corrected by guessing.
 */
export function readInstalledStremioAddons(value: StoredStremioAddons): InstalledStremioAddon[] {
  const stored: readonly StoredStremioAddonEntry[] = Array.isArray(value) ? value : [];
  const installed: InstalledStremioAddon[] = [];
  const seen = new Set<string>();
  for (const raw of stored) {
    if (installed.length >= MAX_STREMIO_ADDONS) break;
    const entry = readStoredEntry(raw);
    if (entry === undefined) continue;
    const parsed = parseStremioAddonUrl(entry.url);
    if (!parsed.ok || seen.has(parsed.addon.providerId)) continue;
    seen.add(parsed.addon.providerId);
    const name = cleanStremioAddonName(entry.name, parsed.addon.manifestUrl);
    installed.push({
      ...parsed.addon,
      displayName: name ?? stremioAddonDisplayLabel(parsed.addon),
      entry: { url: parsed.addon.manifestUrl, ...(name ? { name } : null) },
    });
  }
  return installed;
}

/** The stored form of {@link readInstalledStremioAddons}. */
export function normalizeStremioAddonEntries(
  value: StoredStremioAddons,
): readonly StremioAddonConfigEntry[] {
  return readInstalledStremioAddons(value).map((addon) => addon.entry);
}

/**
 * The stored addon list with one entry's display name updated — nothing else.
 *
 * Display-name refresh is a courtesy write: it must not normalize, drop, or
 * re-add anything a user or another process left in the file. Returns
 * `undefined` when there is no matching installed entry or the stored name is
 * already correct, so callers can skip a pointless write.
 */
export function withStremioAddonName(
  entries: readonly StremioAddonConfigEntry[] | undefined,
  manifestUrl: string,
  name: string,
): readonly StremioAddonConfigEntry[] | undefined {
  const cleanName = cleanStremioAddonName(name, manifestUrl);
  if (!cleanName || !Array.isArray(entries)) return undefined;
  const stored: readonly StremioAddonConfigEntry[] = entries;
  const index = stored.findIndex((raw) => {
    const entry = readStoredEntry(raw);
    if (!entry) return false;
    const parsed = parseStremioAddonUrl(entry.url);
    return parsed.ok && parsed.addon.manifestUrl === manifestUrl;
  });
  const previous = stored[index];
  if (!previous || previous.name === cleanName) return undefined;
  const result = [...stored];
  result[index] = isJsonObject(previous)
    ? { ...previous, name: cleanName }
    : { url: manifestUrl, name: cleanName };
  return result;
}

export type AddStremioAddonResult =
  | {
      readonly ok: true;
      readonly entries: readonly StremioAddonConfigEntry[];
      readonly addon: InstalledStremioAddon;
      /** False when the URL was already installed; its name may still have been updated. */
      readonly added: boolean;
    }
  | { readonly ok: false; readonly reason: string };

export function addStremioAddon(
  current: readonly StremioAddonConfigEntry[],
  url: string,
  name?: string,
): AddStremioAddonResult {
  const parsed = parseStremioAddonUrl(url);
  if (!parsed.ok) return parsed;
  const installed = readInstalledStremioAddons(current);
  const existing = installed.find((addon) => addon.providerId === parsed.addon.providerId);
  const cleanName = cleanStremioAddonName(name, parsed.addon.manifestUrl) ?? existing?.entry.name;
  const entry: StremioAddonConfigEntry = {
    url: parsed.addon.manifestUrl,
    ...(cleanName ? { name: cleanName } : null),
  };
  const addon: InstalledStremioAddon = {
    ...parsed.addon,
    displayName: cleanName ?? stremioAddonDisplayLabel(parsed.addon),
    entry,
  };
  if (existing) {
    return {
      ok: true,
      added: false,
      addon,
      entries: installed.map((item) => (item.providerId === addon.providerId ? entry : item.entry)),
    };
  }
  if (installed.length >= MAX_STREMIO_ADDONS) {
    return {
      ok: false,
      reason: `Kunai keeps at most ${MAX_STREMIO_ADDONS} addons. Remove one first.`,
    };
  }
  return {
    ok: true,
    added: true,
    addon,
    entries: [...installed.map((item) => item.entry), entry],
  };
}

/**
 * Find an installed addon by what a person would type: its position in the
 * list (1-based), its provider id, its manifest URL, its host, or its name.
 * A host or name shared by two addons matches neither; the caller must be
 * told to use the number instead.
 */
export function findInstalledStremioAddon(
  installed: readonly InstalledStremioAddon[],
  target: string,
): InstalledStremioAddon | "ambiguous" | undefined {
  const wanted = target.trim();
  if (!wanted) return undefined;
  if (/^\d+$/.test(wanted)) return installed[Number.parseInt(wanted, 10) - 1];
  const byId = installed.find((addon) => addon.providerId === wanted);
  if (byId) return byId;
  const asUrl = parseStremioAddonUrl(wanted);
  if (asUrl.ok) return installed.find((addon) => addon.providerId === asUrl.addon.providerId);
  const lower = wanted.toLowerCase();
  const matches = installed.filter(
    (addon) => addon.host.toLowerCase() === lower || addon.displayName.toLowerCase() === lower,
  );
  if (matches.length > 1) return "ambiguous";
  return matches[0];
}

export function removeStremioAddon(
  current: readonly StremioAddonConfigEntry[],
  providerId: string,
): readonly StremioAddonConfigEntry[] {
  return readInstalledStremioAddons(current)
    .filter((addon) => addon.providerId !== providerId)
    .map((addon) => addon.entry);
}

/** Whether the addon behind `providerId` is still in the stored list. */
export function isStremioAddonInstalled(
  current: readonly StremioAddonConfigEntry[],
  providerId: string,
): boolean {
  return readInstalledStremioAddons(current).some((addon) => addon.providerId === providerId);
}

/** The config keys that can name an addon's provider id. */
export interface StremioAddonReferenceSlice {
  readonly stremioAddons: readonly StremioAddonConfigEntry[];
  readonly provider: string;
  readonly providerPriority: readonly string[];
  readonly disabledProviders: readonly string[];
  readonly titleProviderPreferences: Record<string, string>;
}

/**
 * Remove an addon and every setting that names it.
 *
 * Removing only the list entry would leave its id as the default provider, in
 * the fallback order, among the switches and in per-title choices: settings
 * that point at a provider which no longer exists.
 */
export function removeStremioAddonFromConfig<T extends StremioAddonReferenceSlice>(
  config: T,
  providerId: string,
): T {
  const providerPriority = config.providerPriority.filter((id) => id !== providerId);
  return {
    ...config,
    stremioAddons: removeStremioAddon(config.stremioAddons, providerId),
    provider:
      config.provider === providerId
        ? (providerPriority[0] ?? DEFAULT_CONFIG.provider)
        : config.provider,
    providerPriority,
    disabledProviders: config.disabledProviders.filter((id) => id !== providerId),
    titleProviderPreferences: Object.fromEntries(
      Object.entries(config.titleProviderPreferences).filter(([, id]) => id !== providerId),
    ),
  };
}

/** Just the keys {@link removeStremioAddonFromConfig} may change, for a partial update. */
export function stremioAddonReferenceSlice(
  config: StremioAddonReferenceSlice,
): StremioAddonReferenceSlice {
  return {
    stremioAddons: config.stremioAddons,
    provider: config.provider,
    providerPriority: config.providerPriority,
    disabledProviders: config.disabledProviders,
    titleProviderPreferences: config.titleProviderPreferences,
  };
}
