import { createHash } from "node:crypto";

import type { ProviderId } from "@kunai/types";

import { isSafeManifestHttpsUrl } from "../shared/manifest-bundle";
import type { StremioContentType } from "./protocol";

/** Every addon provider id starts with this, so a reader can tell one from a bundled provider. */
export const STREMIO_ADDON_PROVIDER_ID_PREFIX = "stremio-";

const MANIFEST_SUFFIX = "/manifest.json";

/** One installed addon, derived entirely from the manifest URL the user gave. */
export interface StremioAddonRef {
  /** Stable provider id: `stremio-<host>-<hash of the URL>`. */
  readonly providerId: ProviderId;
  /** Normalized `https://…/manifest.json`. May carry the user's own settings or tokens in its path. */
  readonly manifestUrl: string;
  /** The manifest URL without `/manifest.json`; resource paths are appended to it. */
  readonly baseUrl: string;
  /** Host only. The one part of the URL that is safe to show, log, or put in a trace. */
  readonly host: string;
}

export type StremioAddonUrlResult =
  | { readonly ok: true; readonly addon: StremioAddonRef }
  | { readonly ok: false; readonly reason: string };

/**
 * Read a manifest URL the user typed or pasted.
 *
 * Accepts `https://…/manifest.json` and the `stremio://…/manifest.json` form
 * that addon pages hand out, which is the same address under another scheme.
 * Everything else is refused with a reason: plain HTTP, credentials in the URL,
 * a private or loopback host, a query string, or a path that is not a manifest.
 * The URL is never completed or corrected by guessing.
 */
export function parseStremioAddonUrl(input: string): StremioAddonUrlResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, reason: "Type an addon manifest URL." };
  const candidate = trimmed.replace(/^stremio:\/\//i, "https://");

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, reason: "That is not a URL. Paste the addon's manifest.json address." };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: "Addon URLs must start with https://." };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "Addon URLs must not contain a username or password." };
  }
  if (url.search) {
    return {
      ok: false,
      reason: "Addon URLs must not have a query string (the part after ?).",
    };
  }
  url.hash = "";
  if (!url.pathname.endsWith(MANIFEST_SUFFIX)) {
    return { ok: false, reason: "Addon URLs must end in /manifest.json." };
  }
  const manifestUrl = url.href;
  if (!isSafeManifestHttpsUrl(manifestUrl)) {
    return {
      ok: false,
      reason: "Addon URLs must point at a public host, not a local or private address.",
    };
  }

  return {
    ok: true,
    addon: {
      providerId: stremioAddonProviderId(manifestUrl, url.hostname),
      manifestUrl,
      baseUrl: manifestUrl.slice(0, -MANIFEST_SUFFIX.length),
      host: url.host,
    },
  };
}

/**
 * Same URL, same id, on every machine and every release: the id is stored in
 * the user's provider order, switches and per-title choices. The hash keeps two
 * configurations of one addon host apart without putting the path, which may
 * hold a token, into the id.
 */
function stremioAddonProviderId(manifestUrl: string, hostname: string): ProviderId {
  const hostSlug = hostname
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const digest = createHash("sha256").update(manifestUrl).digest("hex").slice(0, 8);
  return `${STREMIO_ADDON_PROVIDER_ID_PREFIX}${hostSlug}-${digest}`;
}

export function isStremioAddonProviderId(providerId: string): boolean {
  return providerId.startsWith(STREMIO_ADDON_PROVIDER_ID_PREFIX);
}

/**
 * `{base}/stream/{type}/{id}.json`. The id is percent-encoded as one path
 * segment, which is what the official client sends (`tt0944947%3A1%3A2`).
 */
export function stremioStreamUrl(
  addon: Pick<StremioAddonRef, "baseUrl">,
  type: StremioContentType,
  videoId: string,
): string {
  return `${addon.baseUrl}/stream/${type}/${encodeURIComponent(videoId)}.json`;
}

const IMDB_ID = /^tt\d{5,10}$/;

export function isImdbTitleId(value: string | undefined): value is string {
  return value !== undefined && IMDB_ID.test(value);
}

/**
 * The id an addon is asked about: the IMDb id for a movie, and
 * `tt…:season:episode` for one episode of a series.
 */
export function stremioVideoId(
  imdbId: string,
  coordinates?: { readonly season: number; readonly episode: number },
): string {
  return coordinates ? `${imdbId}:${coordinates.season}:${coordinates.episode}` : imdbId;
}
