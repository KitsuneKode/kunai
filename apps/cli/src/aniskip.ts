import type { PlaybackTimingMetadata, PlaybackTimingSegment } from "@/domain/types";

const ANISKIP_API = "https://api.aniskip.com/v1/skip-times";
const ARM_API = "https://arm.haglund.dev/api/v2/ids";

type AniSkipInterval = {
  startTime: number;
  endTime: number;
};

type AniSkipResult = {
  interval: AniSkipInterval;
  skipType: string;
  skipId: string;
  episodeLength: number;
};

type AniSkipResponse = {
  found: boolean;
  results: AniSkipResult[];
};

type ArmResponse = {
  myanimelist?: number | null;
  anilist?: number | null;
  [key: string]: unknown;
};

const malIdCache = new Map<string, number | null>();
const anilistIdByNameCache = new Map<string, string | null>();

// AniList IDs are purely numeric. AllAnime and other providers return non-numeric
// internal IDs (e.g. AllAnime uses base62 MongoDB ObjectIDs). Only a numeric string
// can be passed directly to arm.haglund.dev as an AniList source ID.
function isNumericAniListId(id: string): boolean {
  return /^\d+$/.test(id);
}

async function resolveAniListIdByName(name: string, signal?: AbortSignal): Promise<string | null> {
  const key = name.toLowerCase();
  if (anilistIdByNameCache.has(key)) return anilistIdByNameCache.get(key) ?? null;

  try {
    const query = `query ($s: String) { Media(search: $s, type: ANIME) { id } }`;
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({ query, variables: { s: name } }),
      signal: signal ?? AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      anilistIdByNameCache.set(key, null);
      return null;
    }
    const data = (await res.json()) as { data?: { Media?: { id?: number } } };
    const id = data?.data?.Media?.id;
    const result = typeof id === "number" ? String(id) : null;
    anilistIdByNameCache.set(key, result);
    return result;
  } catch {
    anilistIdByNameCache.set(key, null);
    return null;
  }
}

async function resolveMALId(anilistId: string, signal?: AbortSignal): Promise<number | null> {
  if (malIdCache.has(anilistId)) return malIdCache.get(anilistId) ?? null;

  try {
    const res = await fetch(`${ARM_API}?source=anilist&id=${encodeURIComponent(anilistId)}`, {
      signal: signal ?? AbortSignal.timeout(4_000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      malIdCache.set(anilistId, null);
      return null;
    }
    const data = (await res.json()) as ArmResponse;
    const malId = typeof data.myanimelist === "number" ? data.myanimelist : null;
    malIdCache.set(anilistId, malId);
    return malId;
  } catch {
    malIdCache.set(anilistId, null);
    return null;
  }
}

function skipTypeToField(skipType: string): "intro" | "recap" | "credits" | "preview" | null {
  switch (skipType) {
    case "op":
    case "mixed-op":
      return "intro";
    case "ed":
    case "mixed-ed":
      return "credits";
    case "recap":
      return "recap";
    default:
      return null;
  }
}

function toSegment(interval: AniSkipInterval): PlaybackTimingSegment {
  return {
    startMs: Math.round(interval.startTime * 1000),
    endMs: Math.round(interval.endTime * 1000),
  };
}

export async function fetchAniSkipTimingMetadata(opts: {
  anilistId: string;
  titleName?: string;
  episode: number;
  episodeLength?: number;
  signal?: AbortSignal;
}): Promise<PlaybackTimingMetadata | null> {
  const { anilistId, titleName, episode, episodeLength, signal } = opts;

  // Resolve a numeric AniList ID. If the provider's title.id is a non-numeric
  // internal ID (e.g. AllAnime's base62 ObjectID), fall back to a title-name
  // lookup via the AniList GraphQL API.
  const resolvedAnilistId = isNumericAniListId(anilistId)
    ? anilistId
    : titleName
      ? await resolveAniListIdByName(titleName, signal)
      : null;

  if (!resolvedAnilistId) return null;

  const malId = await resolveMALId(resolvedAnilistId, signal);
  if (!malId) return null;

  const types = ["op", "ed", "recap"];
  const params = new URLSearchParams(types.map((t) => ["types", t] as [string, string]));
  if (episodeLength !== undefined) params.set("episode_length", String(episodeLength));

  try {
    const res = await fetch(`${ANISKIP_API}/${malId}/${episode}?${params.toString()}`, {
      signal: signal ?? AbortSignal.timeout(5_000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;

    const data = (await res.json()) as AniSkipResponse;
    if (!data.found || !data.results?.length) return null;

    const intro: PlaybackTimingSegment[] = [];
    const recap: PlaybackTimingSegment[] = [];
    const credits: PlaybackTimingSegment[] = [];
    const preview: PlaybackTimingSegment[] = [];

    for (const result of data.results) {
      const field = skipTypeToField(result.skipType);
      if (!field) continue;
      const seg = toSegment(result.interval);
      if (field === "intro") intro.push(seg);
      else if (field === "recap") recap.push(seg);
      else if (field === "credits") credits.push(seg);
      else if (field === "preview") preview.push(seg);
    }

    if (!intro.length && !recap.length && !credits.length && !preview.length) return null;

    return {
      tmdbId: anilistId,
      type: "series",
      intro,
      recap,
      credits,
      preview,
    };
  } catch {
    return null;
  }
}

