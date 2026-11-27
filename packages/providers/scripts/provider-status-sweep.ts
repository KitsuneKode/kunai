/**
 * Live provider-status sweep.
 *
 * Runs each production provider module against a known-good fixture title on
 * the caller's network and writes `apps/docs/lib/generated-provider-status.json`.
 * The scheduled workflow (.github/workflows/provider-status-sweep.yml) runs
 * this on GitHub's egress so the published board reflects a clean-region view;
 * a local run reports *this* network's view and is still useful for diagnosing
 * region-gated providers.
 *
 * Always exits 0: an exhausted or blocked provider is status data, not a
 * script failure. Non-zero would only mean the sweep itself could not run.
 */
import fs from "node:fs";
import path from "node:path";

import { providerAttemptTimeoutMs } from "@kunai/core";
import {
  DEFAULT_STARTUP_PRIORITY,
  isJsonString,
  ProviderHttpError,
  type ProviderModule,
  type ProviderResolveInput,
  type ProviderResolveResult,
  type ProviderRuntimeContext,
  type ResolveErrorCode,
  type StreamCandidate,
} from "@kunai/types";

import { allmangaProviderModule } from "../src/allmanga/direct";
import { anidapProviderModule } from "../src/anidap/direct";
import { anilightProviderModule } from "../src/anilight/direct";
import { animeggProviderModule } from "../src/animegg/direct";
import { filesunProviderModule } from "../src/filesun/direct";
import { hianimeProviderModule } from "../src/hianime/direct";
import { kickassanimeProviderModule } from "../src/kickassanime/direct";
import { miruroProviderModule } from "../src/miruro/direct";
import { movyProviderModule } from "../src/movy/direct";
import { rivestreamProviderModule } from "../src/rivestream/direct";
import { vidboltProviderModule } from "../src/vidbolt/direct";
import { videasyProviderModule } from "../src/videasy/index";
import { vidlinkProviderModule } from "../src/vidlink/direct";
import { vidrockProviderModule } from "../src/vidrock/direct";
import {
  configureYoutubeProvider,
  createYoutubeMetadataService,
  youtubeProviderModule,
} from "../src/youtube/index";

const OUTPUT_PATH = path.resolve(
  import.meta.dir,
  "../../../apps/docs/lib/generated-provider-status.json",
);

const RESOLVE_TIMEOUT_MS = 30_000;
const FRONT_DOOR_TIMEOUT_MS = 12_000;
const DEFAULT_ATTEMPT_BUDGET_MS = providerAttemptTimeoutMs(DEFAULT_STARTUP_PRIORITY);

export type SweepStatus = "healthy" | "degraded" | "blocked" | "down" | "dead";

interface ProviderRow {
  readonly id: string;
  readonly upstreamHttp: number | null;
  readonly upstreamReachable: boolean;
  readonly resolveStatus: string;
  readonly resolveMs: number | null;
  readonly qualifiedForDefaultPlayback: boolean;
  readonly failureCode: ResolveErrorCode | null;
  readonly streams: number;
  readonly qualities: readonly string[];
  readonly servers: readonly string[];
  readonly audioLanguages: readonly string[];
  readonly subtitleLanes: number;
  readonly effectiveStatus: SweepStatus;
  readonly note: string;
}

interface StatusFile {
  readonly generatedAt: string;
  readonly schemaVersion: 1;
  readonly defaultAttemptBudgetMs: number;
  readonly providers: readonly ProviderRow[];
}

const resolveContext = (signal: AbortSignal): ProviderRuntimeContext => ({
  fetch: {
    runtime: "direct-http",
    fetch: (input, init) => fetch(input, init),
  },
  now: () => new Date().toISOString(),
  signal,
  cache: {
    read: async () => null,
    write: async () => {},
  },
  endpointHealth: {
    shouldTry: () => true,
    recordSuccess: () => {},
    recordFailure: () => {},
  },
});

const MOVIE_INPUT: ProviderResolveInput = {
  allowedRuntimes: ["direct-http"],
  intent: "play",
  mediaKind: "movie",
  title: { id: "tmdb:550", kind: "movie", title: "Fight Club", tmdbId: "550" },
  episode: { season: 1, episode: 1 },
};

const ONE_PIECE_ANILIST: ProviderResolveInput = {
  allowedRuntimes: ["direct-http"],
  intent: "play",
  mediaKind: "anime",
  title: { id: "anilist:21", kind: "anime", title: "One Piece", anilistId: "21" },
  episode: { season: 1, episode: 1 },
};

const ALLMANGA_ONE_PIECE: ProviderResolveInput = {
  allowedRuntimes: ["direct-http"],
  intent: "play",
  mediaKind: "anime",
  title: { id: "allanime:ReooPAxPMsHM4KPMY", kind: "anime", title: "One Piece" },
  episode: { season: 1, episode: 1 },
};

const YOUTUBE_INPUT: ProviderResolveInput = {
  allowedRuntimes: ["direct-http"],
  intent: "play",
  mediaKind: "video",
  title: {
    id: "youtube:dQw4w9WgXcQ",
    kind: "video",
    title: "Rick Astley - Never Gonna Give You Up",
  },
  episode: { season: 1, episode: 1 },
};

interface ProbeSpec {
  readonly id: string;
  readonly module: Pick<ProviderModule, "resolve">;
  readonly frontDoor: string;
  readonly input: ProviderResolveInput;
}

// Exported for the roster-parity test in apps/cli — a production module with no
// probe row is invisible on the status board. Guarded below so importing this
// list never runs the sweep itself.
export const PROBES: readonly ProbeSpec[] = [
  {
    id: "videasy",
    module: videasyProviderModule,
    frontDoor: "https://api.videasy.to",
    input: MOVIE_INPUT,
  },
  {
    id: "vidlink",
    module: vidlinkProviderModule,
    frontDoor: "https://vidlink.pro",
    input: MOVIE_INPUT,
  },
  {
    id: "rivestream",
    module: rivestreamProviderModule,
    frontDoor: "https://www.rivestream.app",
    input: MOVIE_INPUT,
  },
  {
    id: "vidrock",
    module: vidrockProviderModule,
    frontDoor: "https://vidrock.net",
    input: MOVIE_INPUT,
  },
  {
    id: "movy",
    module: movyProviderModule,
    frontDoor: "https://api.wecollege.net",
    input: MOVIE_INPUT,
  },
  {
    id: "vidbolt",
    module: vidboltProviderModule,
    frontDoor: "https://vidbolt.pro",
    input: MOVIE_INPUT,
  },
  {
    // FileSuN's Atlantic lookup is title+year addressed, so the shared movie
    // fixture gains the year the intake verified (Fight Club, 1999).
    id: "filesun",
    module: filesunProviderModule,
    frontDoor: "https://pal.hls.lol",
    input: { ...MOVIE_INPUT, title: { ...MOVIE_INPUT.title, year: 1999 } },
  },
  {
    // The provider id is "allanime" (AllAnime upstream); "allmanga" is the
    // module's internal directory name, not the id rows carry.
    id: "allanime",
    module: allmangaProviderModule,
    frontDoor: "https://api.allanime.day",
    input: ALLMANGA_ONE_PIECE,
  },
  {
    id: "hianime",
    module: hianimeProviderModule,
    frontDoor: "https://hianime.at",
    input: ONE_PIECE_ANILIST,
  },
  {
    id: "miruro",
    module: miruroProviderModule,
    frontDoor: "https://www.miruro.bz",
    input: ONE_PIECE_ANILIST,
  },
  {
    id: "anilight",
    module: anilightProviderModule,
    frontDoor: "https://api.anilight.live",
    input: ONE_PIECE_ANILIST,
  },
  {
    id: "anidap",
    module: anidapProviderModule,
    frontDoor: "https://anidap.lol",
    input: ONE_PIECE_ANILIST,
  },
  {
    id: "animegg",
    module: animeggProviderModule,
    frontDoor: "https://www.animegg.org",
    input: ONE_PIECE_ANILIST,
  },
  {
    id: "kickassanime",
    module: kickassanimeProviderModule,
    frontDoor: "https://kaa.lt",
    input: ONE_PIECE_ANILIST,
  },
  {
    id: "youtube",
    module: youtubeProviderModule,
    frontDoor: "https://www.youtube.com",
    input: YOUTUBE_INPUT,
  },
];

async function probeFrontDoor(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(FRONT_DOOR_TIMEOUT_MS),
      headers: { "user-agent": "Mozilla/5.0 (provider-status-sweep)" },
    });
    return res.status;
  } catch {
    return null;
  }
}

interface Classification {
  status: SweepStatus;
  note: string;
}

const BLOCKED_NOTE = "upstream denied access from the sweep runner";

export function classify(
  upstreamHttp: number | null,
  resolveStatus: string,
  streams: number,
  failureCode: ResolveErrorCode | undefined,
): Classification {
  if (resolveStatus === "resolved" && streams > 0) {
    return { status: "healthy", note: "" };
  }
  if (failureCode === "blocked") {
    return {
      status: "blocked",
      note: BLOCKED_NOTE,
    };
  }
  if (upstreamHttp === null && resolveStatus !== "resolved") {
    return { status: "dead", note: "upstream unreachable" };
  }
  if (upstreamHttp === 503) {
    return { status: "down", note: "upstream reports maintenance" };
  }
  if (resolveStatus === "exhausted") {
    return { status: "degraded", note: "upstream up but resolve exhausted" };
  }
  return { status: "degraded", note: `resolve status ${resolveStatus}` };
}

// Provider text can include signed absolute URLs, redirect locations, or a
// query printed on its own. Strip those before clipping the public text.
function redactPublicText(text: string): string {
  return text
    .replaceAll("\\/", "/")
    .replace(/(?:[a-z][a-z\d+.-]*:)?\/\/\S+|\bwww\.\S+/gi, "[redacted URL]")
    .replace(/(?:[?&]|\b)[\w%.-]+=(?:"[^"]*"|'[^']*'|\S*)|\?\S+/g, "[redacted query]")
    .replace(/\s+/g, " ")
    .trim();
}

export function composeStatusNote(
  classifiedNote: string,
  failureMessage: string | undefined,
): string {
  const label = redactPublicText(classifiedNote);
  const detail = redactPublicText(failureMessage ?? "").slice(0, 140);
  if (!detail || label.includes(detail)) return label;
  return label ? `${label} — ${detail}` : detail;
}

export function qualifiesForDefaultPlayback(
  resolveStatus: string,
  streams: number,
  resolveMs: number,
): boolean {
  return resolveStatus === "resolved" && streams > 0 && resolveMs < DEFAULT_ATTEMPT_BUDGET_MS;
}

export function summarizeProbeResolution<T extends Pick<StreamCandidate, "metadata">>(
  providerId: string,
  upstreamHttp: number | null,
  result: Pick<ProviderResolveResult, "status" | "failures"> & { readonly streams: readonly T[] },
  resolveMs: number,
): Classification & {
  readonly streams: readonly T[];
  readonly qualifiedForDefaultPlayback: boolean;
  readonly failureCode: ResolveErrorCode | null;
} {
  // A watch URL alone can be handed to mpv even when extraction fails.
  const streams =
    providerId === "youtube"
      ? result.streams.filter((stream) => isJsonString(stream.metadata?.formatId))
      : result.streams;
  const { status } = result;
  const resolved = status === "resolved" && streams.length > 0;
  const failure =
    (!resolved && result.failures.find(({ code }) => code === "blocked")) || result.failures[0];
  const classified = classify(upstreamHttp, status, streams.length, failure?.code);
  const qualified = qualifiesForDefaultPlayback(status, streams.length, resolveMs);
  if (resolved) {
    classified.status = qualified ? "healthy" : "degraded";
    const budget = `${DEFAULT_ATTEMPT_BUDGET_MS / 1_000}s`;
    classified.note = qualified
      ? `qualified for default playback (within ${budget})`
      : `resolved within sweep, missed the default ${budget} attempt budget`;
  }
  if (providerId === "youtube" && status === "resolved" && streams.length === 0) {
    classified.note = "yt-dlp did not discover video formats";
  }
  return {
    ...classified,
    streams,
    qualifiedForDefaultPlayback: qualified,
    failureCode: failure?.code ?? null,
    note: composeStatusNote(classified.note, failure?.message),
  };
}

async function probe(spec: ProbeSpec): Promise<ProviderRow> {
  const upstreamHttp = await probeFrontDoor(spec.frontDoor);
  const started = performance.now();
  const signal = AbortSignal.timeout(RESOLVE_TIMEOUT_MS);
  try {
    const result = await spec.module.resolve(
      { ...spec.input, startupPriority: DEFAULT_STARTUP_PRIORITY },
      resolveContext(signal),
    );
    const resolveMs = Math.floor(performance.now() - started);
    const summary = summarizeProbeResolution(spec.id, upstreamHttp, result, resolveMs);
    const { streams } = summary;
    const qualities = [
      ...new Set(streams.map((s) => redactPublicText(s.qualityLabel ?? "")).filter(Boolean)),
    ];
    const servers = [
      ...new Set(streams.map((s) => redactPublicText(s.serverName ?? "")).filter(Boolean)),
    ];
    const audio = [
      ...new Set(streams.flatMap((s) => (s.audioLanguages ?? []).map(redactPublicText))),
    ];
    const subtitleLanes =
      result.subtitles.length ||
      streams.filter((s) => (s.subtitleLanguages?.length ?? 0) > 0).length;
    return {
      id: spec.id,
      upstreamHttp,
      upstreamReachable: upstreamHttp !== null && upstreamHttp < 500,
      resolveStatus: result.status,
      resolveMs,
      qualifiedForDefaultPlayback: summary.qualifiedForDefaultPlayback,
      failureCode: summary.failureCode,
      streams: streams.length,
      qualities,
      servers,
      audioLanguages: audio,
      subtitleLanes,
      effectiveStatus: summary.status,
      note: summary.note,
    };
  } catch (error) {
    const failureCode = error instanceof ProviderHttpError ? error.code : "unknown";
    const classified = classify(upstreamHttp, "error", 0, failureCode);
    return {
      id: spec.id,
      upstreamHttp,
      upstreamReachable: upstreamHttp !== null && upstreamHttp < 500,
      resolveStatus: "error",
      resolveMs: Math.floor(performance.now() - started),
      qualifiedForDefaultPlayback: false,
      failureCode,
      streams: 0,
      qualities: [],
      servers: [],
      audioLanguages: [],
      subtitleLanes: 0,
      effectiveStatus: classified.status,
      note: composeStatusNote(
        classified.note,
        error instanceof Error ? error.message : String(error),
      ),
    };
  }
}

export async function runProviderStatusSweep(probes: readonly ProbeSpec[], outputPath: string) {
  const rows = await Promise.all(probes.map(probe));
  const file: StatusFile = {
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
    defaultAttemptBudgetMs: DEFAULT_ATTEMPT_BUDGET_MS,
    providers: rows,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(file, null, 2)}\n`);
  for (const row of rows) {
    console.log(
      `${row.id.padEnd(10)} ${row.effectiveStatus.padEnd(8)} http=${row.upstreamHttp ?? "—"} resolve=${row.resolveStatus} streams=${row.streams} failure=${row.failureCode ?? "—"} ${row.note}`,
    );
  }
  console.log(`wrote ${outputPath}`);
}

if (import.meta.main) {
  configureYoutubeProvider({ metadataService: createYoutubeMetadataService({}) });
  await runProviderStatusSweep(PROBES, OUTPUT_PATH);
}
