/**
 * Live provider-status sweep.
 *
 * Runs each production provider module against a known-good fixture title on
 * the caller's network and writes two files: `generated-provider-status.json`
 * (the latest result per provider) and `generated-provider-status-history.json`
 * (one status per provider per day, for the history strips). The scheduled
 * workflow (.github/workflows/provider-status-sweep.yml) runs this on GitHub's
 * egress so the published board reflects a clean-region view and publishes the
 * files to the `status-data` branch; a local run reports *this* network's view and
 * is still useful for diagnosing region-gated providers.
 *
 * Where the files go: `KUNAI_STATUS_DIR` when set (the workflow points it at a
 * checkout of `status-data`, and the previous history is read from there too),
 * otherwise `apps/docs/lib`, which holds the seed copy the site falls back to.
 *
 * Always exits 0: an exhausted or blocked provider is status data, not a
 * script failure. Non-zero would only mean the sweep itself could not run.
 */
import fs from "node:fs";
import path from "node:path";

import type { ProviderModule, ProviderResolveInput, ProviderRuntimeContext } from "@kunai/types";

import { allmangaProviderModule } from "../src/allmanga/direct";
import { anidbProviderModule } from "../src/anidb/direct";
import { animeggProviderModule } from "../src/animegg/direct";
import { hianimeProviderModule } from "../src/hianime/direct";
import { kickassanimeProviderModule } from "../src/kickassanime/direct";
import { miruroProviderModule } from "../src/miruro/direct";
import { movyProviderModule } from "../src/movy/direct";
import { rivestreamProviderModule } from "../src/rivestream/direct";
import { videasyProviderModule } from "../src/videasy/index";
import { vidlinkProviderModule } from "../src/vidlink/direct";
import { vidrockProviderModule } from "../src/vidrock/direct";
import { youtubeProviderModule } from "../src/youtube/index";
import {
  type HistoryFile,
  type SweepStatus,
  updateHistory,
  utcDay,
} from "./provider-status-history";

/**
 * Where the files are read from and written to. Read when the sweep runs, not once
 * at module load, so a test can redirect it.
 */
function outputPaths() {
  const dir =
    process.env.KUNAI_STATUS_DIR?.trim() || path.resolve(import.meta.dir, "../../../apps/docs/lib");
  return {
    dir,
    status: path.join(dir, "generated-provider-status.json"),
    history: path.join(dir, "generated-provider-status-history.json"),
  };
}

const RESOLVE_TIMEOUT_MS = 30_000;
const FRONT_DOOR_TIMEOUT_MS = 12_000;

interface ProviderRow {
  readonly id: string;
  readonly upstreamHttp: number | null;
  readonly upstreamReachable: boolean;
  readonly resolveStatus: string;
  readonly resolveMs: number | null;
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

const ANIDB_ONE_PIECE: ProviderResolveInput = {
  allowedRuntimes: ["direct-http"],
  intent: "play",
  mediaKind: "anime",
  title: { id: "one-piece-69", kind: "anime", title: "One Piece" },
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

const PROBES: readonly ProbeSpec[] = [
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
    // The provider id is "allanime" (AllAnime upstream); "allmanga" is the
    // module's internal directory name, not the id rows carry.
    id: "allanime",
    module: allmangaProviderModule,
    frontDoor: "https://api.allanime.day",
    input: ALLMANGA_ONE_PIECE,
  },
  {
    id: "anidb",
    module: anidbProviderModule,
    frontDoor: "https://anidb.app",
    input: ANIDB_ONE_PIECE,
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
    id: "youtube",
    module: youtubeProviderModule,
    frontDoor: "https://www.youtube.com",
    input: YOUTUBE_INPUT,
  },
  // The four below were registered providers the board never showed: a sweep that
  // covers eight of twelve reads as a clean bill of health for the other four.
  // Same fixtures as their siblings: the TMDB-keyed ones take the movie, the
  // anime ones locate the show by name.
  {
    id: "vidrock",
    module: vidrockProviderModule,
    frontDoor: "https://vidrock.net",
    input: MOVIE_INPUT,
  },
  {
    id: "movy",
    module: movyProviderModule,
    frontDoor: "https://movy.sx",
    input: MOVIE_INPUT,
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

function classify(
  upstreamHttp: number | null,
  resolveStatus: string,
  streams: number,
  firstFailureCode: string | undefined,
): Classification {
  if (upstreamHttp === null && resolveStatus !== "resolved") {
    return { status: "dead", note: "upstream unreachable" };
  }
  if (resolveStatus === "resolved" && streams > 0) {
    return { status: "healthy", note: "" };
  }
  if (firstFailureCode === "blocked") {
    return {
      status: "blocked",
      note: "upstream challenges this network (WAF/captcha); relay in an ungated region bypasses",
    };
  }
  if (upstreamHttp === 503) {
    return { status: "down", note: "upstream reports maintenance" };
  }
  if (resolveStatus === "exhausted") {
    return { status: "degraded", note: "upstream up but resolve exhausted" };
  }
  return { status: "degraded", note: `resolve status ${resolveStatus}` };
}

async function probe(spec: ProbeSpec): Promise<ProviderRow> {
  const upstreamHttp = await probeFrontDoor(spec.frontDoor);
  const started = Date.now();
  const signal = AbortSignal.timeout(RESOLVE_TIMEOUT_MS);
  try {
    const result = await spec.module.resolve(spec.input, resolveContext(signal));
    const resolveMs = Date.now() - started;
    const status = result.status;
    const streams = result.streams;
    const failures = result.failures;
    const qualities = [
      ...new Set(streams.map((s) => s.qualityLabel ?? "").filter((q) => q.length > 0)),
    ];
    const servers = [
      ...new Set(streams.map((s) => s.serverName ?? "").filter((s) => s.length > 0)),
    ];
    const audio = [...new Set(streams.flatMap((s) => s.audioLanguages ?? []))];
    const subtitleLanes =
      result.subtitles.length ||
      streams.filter((s) => (s.subtitleLanguages?.length ?? 0) > 0).length;
    const classified = classify(upstreamHttp, status, streams.length, failures[0]?.code);
    if (status !== "resolved" && /captcha|waf|challenge/i.test(failures[0]?.message ?? "")) {
      classified.status = "blocked";
      classified.note =
        "upstream challenges this network (WAF/captcha); relay in an ungated region bypasses";
    }
    const note = classified.note || (failures[0]?.message?.slice(0, 140) ?? "");
    return {
      id: spec.id,
      upstreamHttp,
      upstreamReachable: upstreamHttp !== null && upstreamHttp < 500,
      resolveStatus: status,
      resolveMs,
      streams: streams.length,
      qualities,
      servers,
      audioLanguages: audio,
      subtitleLanes,
      effectiveStatus: classified.status,
      note,
    };
  } catch (error) {
    return {
      id: spec.id,
      upstreamHttp,
      upstreamReachable: upstreamHttp !== null && upstreamHttp < 500,
      resolveStatus: "error",
      resolveMs: Date.now() - started,
      streams: 0,
      qualities: [],
      servers: [],
      audioLanguages: [],
      subtitleLanes: 0,
      effectiveStatus: upstreamHttp === null ? "dead" : upstreamHttp === 503 ? "down" : "degraded",
      note: error instanceof Error ? error.message.slice(0, 140) : String(error),
    };
  }
}

function readHistory(historyPath: string): HistoryFile | null {
  try {
    const parsed: HistoryFile = JSON.parse(fs.readFileSync(historyPath, "utf8"));
    return parsed.schemaVersion === 1 && Array.isArray(parsed.days) ? parsed : null;
  } catch {
    // No history yet (first run) or an unreadable one: start a fresh record rather
    // than fail a sweep over its own bookkeeping.
    return null;
  }
}

async function main() {
  const rows = await Promise.all(PROBES.map(probe));
  const generatedAt = new Date().toISOString();
  const file: StatusFile = { generatedAt, schemaVersion: 1, providers: rows };
  const statuses = Object.fromEntries(rows.map((row) => [row.id, row.effectiveStatus]));
  const out = outputPaths();
  const history = updateHistory(readHistory(out.history), utcDay(generatedAt), statuses);

  fs.mkdirSync(out.dir, { recursive: true });
  fs.writeFileSync(out.status, `${JSON.stringify(file, null, 2)}\n`);
  fs.writeFileSync(out.history, `${JSON.stringify(history)}\n`);
  for (const row of rows) {
    console.log(
      `${row.id.padEnd(12)} ${row.effectiveStatus.padEnd(8)} http=${row.upstreamHttp ?? "—"} resolve=${row.resolveStatus} streams=${row.streams} ${row.note}`,
    );
  }
  console.log(`wrote ${out.status}`);
  console.log(`wrote ${out.history} (${history.days.length} days)`);
}

await main();
