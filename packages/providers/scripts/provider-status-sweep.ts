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

import { allmangaProviderModule } from "../src/allmanga/direct";
import { anidbProviderModule } from "../src/anidb/direct";
import { hianimeProviderModule } from "../src/hianime/direct";
import { miruroProviderModule } from "../src/miruro/direct";
import { rivestreamProviderModule } from "../src/rivestream/direct";
import { videasyProviderModule } from "../src/videasy/index";
import { vidlinkProviderModule } from "../src/vidlink/direct";
import { youtubeProviderModule } from "../src/youtube/index";

const OUTPUT_PATH = path.resolve(
  import.meta.dir,
  "../../../apps/docs/lib/generated-provider-status.json",
);

const RESOLVE_TIMEOUT_MS = 30_000;
const FRONT_DOOR_TIMEOUT_MS = 12_000;

type SweepStatus = "healthy" | "degraded" | "blocked" | "down" | "dead";

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

const resolveContext = (signal: AbortSignal) =>
  ({
    fetchImpl: fetch,
    now: () => new Date(),
    signal,
    cache: { read: async () => null, write: async () => {} },
    endpointHealth: {
      isDown: () => false,
      shouldTry: () => true,
      recordSuccess: () => {},
      recordFailure: () => {},
    },
  }) as never;

const MOVIE_INPUT = {
  allowedRuntimes: ["direct-http"],
  mediaKind: "movie",
  title: { id: "tmdb:550", kind: "movie", title: "Fight Club", tmdbId: 550 },
  episode: { season: 1, episode: 1 },
} as const;

const ONE_PIECE_ANILIST = {
  allowedRuntimes: ["direct-http"],
  mediaKind: "anime",
  title: { id: "anilist:21", kind: "anime", title: "One Piece", anilistId: "21" },
  episode: { season: 1, episode: 1 },
} as const;

const ALLMANGA_ONE_PIECE = {
  allowedRuntimes: ["direct-http"],
  mediaKind: "anime",
  title: { id: "allanime:ReooPAxPMsHM4KPMY", kind: "anime", title: "One Piece" },
  episode: { season: 1, episode: 1 },
} as const;

const ANIDB_ONE_PIECE = {
  allowedRuntimes: ["direct-http"],
  mediaKind: "anime",
  title: { id: "one-piece-69", kind: "anime", title: "One Piece" },
  episode: { season: 1, episode: 1 },
} as const;

const YOUTUBE_INPUT = {
  allowedRuntimes: ["direct-http"],
  mediaKind: "video",
  title: {
    id: "youtube:dQw4w9WgXcQ",
    kind: "video",
    title: "Rick Astley - Never Gonna Give You Up",
  },
  episode: { season: 1, episode: 1 },
} as const;

interface ProbeSpec {
  readonly id: string;
  readonly module: { resolve: (input: unknown, context: unknown) => Promise<unknown> };
  readonly frontDoor: string;
  readonly input: unknown;
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
    id: "allmanga",
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

function classify(
  upstreamHttp: number | null,
  resolveStatus: string,
  streams: number,
  firstFailureCode: string | undefined,
): { status: SweepStatus; note: string } {
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
    const result = (await spec.module.resolve(spec.input, resolveContext(signal))) as Record<
      string,
      unknown
    >;
    const resolveMs = Date.now() - started;
    const status = String(result.status ?? "unknown");
    const streams = (result.streams ?? []) as Record<string, unknown>[];
    const failures = (result.failures ?? []) as { code?: string; message?: string }[];
    const qualities = [
      ...new Set(
        streams.map((s) => String(s.qualityHint ?? s.quality ?? "")).filter((q) => q.length > 0),
      ),
    ];
    const servers = [
      ...new Set(streams.map((s) => String(s.serverLabel ?? "")).filter((s) => s.length > 0)),
    ];
    const audio = [...new Set(streams.flatMap((s) => (s.audioLanguages ?? []) as string[]))];
    const subtitleLanes =
      ((result.subtitles ?? []) as unknown[]).length ||
      streams.filter((s) => ((s.subtitles ?? []) as unknown[]).length > 0).length;
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

async function main() {
  const rows = await Promise.all(PROBES.map(probe));
  const file: StatusFile = {
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
    providers: rows,
  };
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(file, null, 2)}\n`);
  for (const row of rows) {
    console.log(
      `${row.id.padEnd(10)} ${row.effectiveStatus.padEnd(8)} http=${row.upstreamHttp ?? "—"} resolve=${row.resolveStatus} streams=${row.streams} ${row.note}`,
    );
  }
  console.log(`wrote ${OUTPUT_PATH}`);
}

await main();
