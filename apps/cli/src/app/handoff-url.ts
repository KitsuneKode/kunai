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

function normalizeSearch(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 200) : null;
}

function normalizeToken(value: string | null): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed || null;
}
