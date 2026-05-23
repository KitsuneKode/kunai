import type { ShellMode, TitleInfo } from "@/domain/types";

export type KunaiHandoffAction = "play" | "download";

export type KunaiHandoffLaunch = {
  readonly action: KunaiHandoffAction;
  readonly search?: string;
  readonly id?: string;
  readonly type?: "movie" | "series";
  readonly anime?: true;
  readonly requiresConfirmation: true;
};

const SUPPORTED_DIRECT_TYPES = new Set(["movie", "series"]);

export const KUNAI_INSTALL_URL = "https://github.com/KitsuneKode/kunai#install";
export const KUNAI_INSTALL_SCRIPT_URL =
  "https://raw.githubusercontent.com/KitsuneKode/kunai/main/install.sh";

export function parseKunaiHandoffUrl(value: string): KunaiHandoffLaunch | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== "kunai:") return null;

  const action = resolveHandoffAction(url);
  if (!action) return null;

  const search = normalizeSearch(url.searchParams.get("search"));
  const id = normalizeToken(url.searchParams.get("id"));
  const type = normalizeToken(url.searchParams.get("type"));
  const anime = url.searchParams.get("mode") === "anime";

  if (search) {
    return {
      action,
      search,
      ...(anime ? { anime: true as const } : {}),
      requiresConfirmation: true,
    };
  }

  if (!id || !type || !SUPPORTED_DIRECT_TYPES.has(type)) return null;

  return {
    action,
    id,
    type: type as "movie" | "series",
    requiresConfirmation: true,
  };
}

export function buildKunaiPlaybackHandoffUrl(input: {
  readonly title: Pick<TitleInfo, "id" | "type" | "name" | "externalIds">;
  readonly mode: ShellMode;
}): string | null {
  const tmdbId = resolveTmdbId(input.title);
  if (tmdbId && input.mode !== "anime" && !input.title.id.startsWith("anilist:")) {
    const type = input.title.type === "movie" ? "movie" : "series";
    return `kunai://play?id=${encodeURIComponent(tmdbId)}&type=${type}`;
  }

  const search = normalizeSearch(input.title.name);
  if (!search) return null;
  if (input.mode === "anime" || input.title.id.startsWith("anilist:")) {
    return `kunai://play?search=${encodeURIComponent(search)}&mode=anime`;
  }
  return `kunai://play?search=${encodeURIComponent(search)}`;
}

export function describeKunaiHandoffLaunch(handoff: KunaiHandoffLaunch): string {
  const target = handoff.search
    ? `search "${handoff.search}"`
    : `${handoff.type ?? "title"} ${handoff.id ?? ""}`.trim();
  const mode = handoff.anime ? "anime mode" : "default mode";
  return handoff.action === "download"
    ? `Queue a download for ${target} in ${mode}`
    : `Open playback for ${target} in ${mode}`;
}

function resolveHandoffAction(url: URL): KunaiHandoffAction | null {
  const hostAction = normalizeToken(url.hostname);
  if (hostAction === "play" || hostAction === "download") return hostAction;

  const pathAction = normalizeToken(url.pathname.split("/").find(Boolean) ?? null);
  if (pathAction === "play" || pathAction === "download") return pathAction;

  return null;
}

function resolveTmdbId(title: Pick<TitleInfo, "id" | "externalIds">): string | null {
  const fromExternal = title.externalIds?.tmdbId?.trim();
  if (fromExternal) return fromExternal;
  const match = /^tmdb:(\d+)$/.exec(title.id.trim());
  return match?.[1] ?? null;
}

function normalizeSearch(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 200) : null;
}

function normalizeToken(value: string | null): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed || null;
}
