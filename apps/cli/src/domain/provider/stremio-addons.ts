import { DEFAULT_CONFIG, type StremioAddonConfigEntry } from "@kunai/config";
import {
  parseStremioAddonUrl,
  toDisplayText,
  type StremioAddonRef,
} from "@kunai/providers/stremio-addon";

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
 * An addon's name as it may be shown: one line of printable text. It comes
 * from a server the user does not control and lands in pickers and footers.
 */
export function cleanStremioAddonName(value: unknown): string | undefined {
  return typeof value === "string" ? toDisplayText(value, MAX_ADDON_NAME_LENGTH) : undefined;
}

/**
 * The addons a stored value really describes.
 *
 * `config.json` is hand-editable, so every entry is re-read through the same
 * URL parser the add path uses: an entry that is not a public
 * `https://…/manifest.json` address is dropped, and a URL listed twice is kept
 * once. Nothing is corrected by guessing.
 */
export function readInstalledStremioAddons(value: unknown): InstalledStremioAddon[] {
  if (!Array.isArray(value)) return [];
  const installed: InstalledStremioAddon[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (installed.length >= MAX_STREMIO_ADDONS) break;
    const url =
      typeof raw === "string"
        ? raw
        : typeof raw === "object" && raw !== null && "url" in raw && typeof raw.url === "string"
          ? raw.url
          : undefined;
    if (url === undefined) continue;
    const parsed = parseStremioAddonUrl(url);
    if (!parsed.ok || seen.has(parsed.addon.providerId)) continue;
    seen.add(parsed.addon.providerId);
    const name = cleanStremioAddonName(
      typeof raw === "object" && raw !== null && "name" in raw ? raw.name : undefined,
    );
    installed.push({
      ...parsed.addon,
      displayName: name ?? parsed.addon.host,
      entry: { url: parsed.addon.manifestUrl, ...(name ? { name } : null) },
    });
  }
  return installed;
}

/** The stored form of {@link readInstalledStremioAddons}. */
export function normalizeStremioAddonEntries(value: unknown): readonly StremioAddonConfigEntry[] {
  return readInstalledStremioAddons(value).map((addon) => addon.entry);
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
  const cleanName = cleanStremioAddonName(name) ?? existing?.entry.name;
  const entry: StremioAddonConfigEntry = {
    url: parsed.addon.manifestUrl,
    ...(cleanName ? { name: cleanName } : null),
  };
  const addon: InstalledStremioAddon = {
    ...parsed.addon,
    displayName: cleanName ?? parsed.addon.host,
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
