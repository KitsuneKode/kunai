import {
  encodePlaybackTargetRef,
  parseKunaiShareUrl,
  type CatalogNs,
  type KunaiShareAction,
  type PlaybackTargetRef,
  type ShareAnchor,
} from "@/domain/share/playback-target-ref";
import type { ShellMode, TitleInfo } from "@/domain/types";

export type KunaiHandoffLaunch = {
  readonly action: KunaiShareAction;
  readonly ref: PlaybackTargetRef;
  readonly requiresConfirmation: true;
};

export const KUNAI_INSTALL_URL = "https://github.com/KitsuneKode/kunai#install";
export const KUNAI_INSTALL_SCRIPT_URL =
  "https://raw.githubusercontent.com/KitsuneKode/kunai/main/install.sh";

export function parseKunaiHandoffUrl(value: string): KunaiHandoffLaunch | null {
  const parsed = parseKunaiShareUrl(value);
  if (!parsed) return null;
  return { action: parsed.action, ref: parsed.ref, requiresConfirmation: true };
}

export function buildKunaiPlaybackHandoffUrl(input: {
  readonly title: Pick<TitleInfo, "id" | "type" | "name" | "externalIds" | "isAnime">;
  readonly mode: ShellMode;
  readonly episode?: { readonly season: number; readonly episode: number };
  readonly startSeconds?: number;
  readonly providerId?: string;
}): string | null {
  const ref = buildShareRefFromTitleContext(input);
  return ref ? encodePlaybackTargetRef(ref) : null;
}

export function describeKunaiHandoffLaunch(handoff: KunaiHandoffLaunch): string {
  const target = describeShareAnchor(handoff.ref.anchor, handoff.ref.kind);
  const episode =
    handoff.ref.season !== undefined && handoff.ref.episode !== undefined
      ? ` S${handoff.ref.season}E${handoff.ref.episode}`
      : handoff.ref.absoluteEpisode !== undefined
        ? ` ep ${handoff.ref.absoluteEpisode}`
        : "";
  const timestamp = handoff.ref.startSeconds !== undefined ? ` @ ${handoff.ref.startSeconds}s` : "";
  const mode = handoff.ref.kind === "anime" ? "anime mode" : "default mode";
  return handoff.action === "download"
    ? `Queue a download for ${target}${episode} in ${mode}`
    : `Open playback for ${target}${episode}${timestamp} in ${mode}`;
}

export function buildShareRefFromTitleContext(input: {
  readonly title: Pick<TitleInfo, "id" | "type" | "name" | "externalIds" | "isAnime">;
  readonly mode: ShellMode;
  readonly episode?: { readonly season: number; readonly episode: number };
  readonly absoluteEpisode?: number;
  readonly startSeconds?: number;
  readonly providerId?: string;
}): PlaybackTargetRef | null {
  const anchor = resolveShareAnchor(input.title, input.mode);
  if (!anchor) return null;
  const kind = resolveShareKind(input.title, input.mode);
  return {
    anchor,
    kind,
    ...(input.episode ? { season: input.episode.season, episode: input.episode.episode } : {}),
    ...(input.absoluteEpisode !== undefined ? { absoluteEpisode: input.absoluteEpisode } : {}),
    ...(input.startSeconds !== undefined ? { startSeconds: input.startSeconds } : {}),
    ...(input.title.name ? { title: input.title.name } : {}),
    ...(input.providerId ? { hint: { providerId: input.providerId } } : {}),
  };
}

function resolveShareKind(
  title: Pick<TitleInfo, "type" | "isAnime">,
  mode: ShellMode,
): PlaybackTargetRef["kind"] {
  if (mode === "anime" || title.isAnime) return "anime";
  return title.type === "movie" ? "movie" : "series";
}

function resolveShareAnchor(
  title: Pick<TitleInfo, "id" | "name" | "externalIds">,
  mode: ShellMode,
): ShareAnchor | null {
  const external = title.externalIds;
  if (external?.anilistId?.trim()) {
    return { by: "catalog", ns: "anilist", id: external.anilistId.trim() };
  }
  if (external?.tmdbId?.trim()) {
    return { by: "catalog", ns: "tmdb", id: external.tmdbId.trim() };
  }
  if (external?.malId?.trim()) {
    return { by: "catalog", ns: "mal", id: external.malId.trim() };
  }
  if (external?.imdbId?.trim()) {
    const id = external.imdbId.trim().replace(/^tt/, "");
    return { by: "catalog", ns: "imdb", id: id.startsWith("tt") ? id : `tt${id}` };
  }
  const anilistFromId = /^anilist:(\d+)$/.exec(title.id.trim());
  if (anilistFromId?.[1]) {
    return { by: "catalog", ns: "anilist", id: anilistFromId[1] };
  }
  const tmdbFromId = /^tmdb:(\d+)$/.exec(title.id.trim());
  if (tmdbFromId?.[1]) {
    return { by: "catalog", ns: "tmdb", id: tmdbFromId[1] };
  }
  const malFromId = /^mal:(\d+)$/.exec(title.id.trim());
  if (malFromId?.[1]) {
    return { by: "catalog", ns: "mal", id: malFromId[1] };
  }
  const query = title.name?.trim();
  if (!query) return null;
  if (mode === "anime" || title.id.startsWith("anilist:")) {
    return { by: "search", query: query.slice(0, 200) };
  }
  return { by: "search", query: query.slice(0, 200) };
}

function describeShareAnchor(anchor: ShareAnchor, kind: PlaybackTargetRef["kind"]): string {
  if (anchor.by === "search") return `search "${anchor.query}"`;
  return `${kind} ${anchor.ns}:${anchor.id}`;
}

export type { CatalogNs, PlaybackTargetRef, ShareAnchor };
