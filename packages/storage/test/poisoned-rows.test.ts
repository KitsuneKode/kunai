import { afterEach, expect, test } from "bun:test";

import {
  ProviderEndpointHealthRepository,
  ProviderHealthRepository,
  ResolveTraceRepository,
  StreamCacheRepository,
} from "../src/index";
import { createTempStoreRegistry } from "./helpers/temp-store";

const stores = createTempStoreRegistry();
const NOW = "2026-08-16T00:00:00.000Z";

afterEach(() => {
  stores.cleanup();
});

const VALID_HEALTH: Parameters<ProviderHealthRepository["set"]>[0] = {
  providerId: "vidlink",
  status: "degraded",
  checkedAt: NOW,
  consecutiveFailures: 2,
};

const VALID_ENDPOINT: Parameters<ProviderEndpointHealthRepository["set"]>[0] = {
  providerId: "movy",
  endpoint: "denver",
  failureClass: "route-dead",
  consecutiveFailures: 3,
  distinctTitleIds: ["tmdb:1"],
  quarantinedUntil: "2026-08-17T00:00:00.000Z",
  updatedAt: NOW,
};

const VALID_STREAM: Parameters<StreamCacheRepository["set"]>[1] = {
  id: "stream-1",
  providerId: "vidlink",
  url: "https://cdn.example.com/playlist.m3u8",
  protocol: "hls",
  confidence: 0.9,
  cachePolicy: {
    ttlClass: "stream-manifest",
    scope: "local",
    keyParts: ["providerId"],
  },
};

const VALID_TRACE: Parameters<ResolveTraceRepository["add"]>[0] = {
  id: "trace-good",
  startedAt: NOW,
  title: { id: "tmdb:1", kind: "series", title: "Show" },
  cacheHit: false,
  steps: [],
  failures: [],
};

test("provider health: one poisoned row does not blank the list or crash reads", () => {
  const db = stores.store("poison-provider-health", "cache");
  const repo = new ProviderHealthRepository(db);
  repo.set(VALID_HEALTH);
  db.query(
    "INSERT INTO provider_health (provider_id, health_json, checked_at) VALUES ('movy', 'not json{', ?)",
  ).run(NOW);
  db.query(
    "INSERT INTO provider_health (provider_id, health_json, checked_at) VALUES ('rivestream', ?, ?)",
  ).run(JSON.stringify({ providerId: 42, status: "from-the-future" }), NOW);

  expect(repo.get("vidlink")?.consecutiveFailures).toBe(2);
  expect(repo.get("movy")).toBeUndefined();
  expect(repo.get("rivestream" as never)).toBeUndefined();
  expect(repo.list().map((h) => h.providerId)).toEqual(["vidlink"]);
});

test("endpoint health: a poisoned row reads as missing so quarantine checks fail open", () => {
  const db = stores.store("poison-endpoint-health", "cache");
  const repo = new ProviderEndpointHealthRepository(db);
  repo.set(VALID_ENDPOINT);
  db.query(
    `INSERT INTO provider_endpoint_health
       (provider_id, endpoint, health_json, quarantined_until, updated_at)
     VALUES ('movy', 'atlanta', '{"consecutiveFailures":"high"', NULL, ?)`,
  ).run(NOW);

  expect(repo.get("movy", "denver")?.consecutiveFailures).toBe(3);
  expect(repo.get("movy", "atlanta")).toBeUndefined();
  expect(repo.list().map((r) => r.endpoint)).toEqual(["denver"]);
});

test("stream cache: a poisoned row is evicted and treated as a miss", () => {
  const db = stores.store("poison-stream-cache", "cache");
  const repo = new StreamCacheRepository(db);
  repo.set("good-key", VALID_STREAM, "2099-01-01T00:00:00.000Z", NOW);
  db.query(
    `INSERT INTO stream_cache
       (cache_key, schema_version, provider_id, stream_json, expires_at, created_at, last_accessed_at, hit_count)
     VALUES ('bad-key', 1, 'vidlink', 'corrupt-bytes', '2099-01-01T00:00:00.000Z', ?, ?, 0)`,
  ).run(NOW, NOW);
  db.query(
    `INSERT INTO stream_cache
       (cache_key, schema_version, provider_id, stream_json, expires_at, created_at, last_accessed_at, hit_count)
     VALUES ('ghost-key', 1, 'vidlink', ?, '2099-01-01T00:00:00.000Z', ?, ?, 0)`,
  ).run(JSON.stringify({ id: "ghost", providerId: "vidlink", protocol: "hls" }), NOW, NOW);

  expect(repo.get("good-key")?.stream.id).toBe("stream-1");
  expect(repo.get("bad-key")).toBeUndefined();
  expect(repo.get("ghost-key")).toBeUndefined();
  // Poisoned rows are deleted on read so the next get() is a clean miss too.
  const remaining = db
    .query<{ cache_key: string }, []>("SELECT cache_key FROM stream_cache")
    .all()
    .map((row) => row.cache_key);
  expect(remaining).toEqual(["good-key"]);
});

test("resolve traces: a poisoned row is skipped, valid traces still load", () => {
  const db = stores.store("poison-resolve-trace", "cache");
  const repo = new ResolveTraceRepository(db);
  repo.add(VALID_TRACE);
  db.query(
    "INSERT INTO resolve_traces (trace_id, trace_json, started_at, created_at) VALUES ('trace-bad', 'not-json', ?, ?)",
  ).run(NOW, NOW);
  db.query(
    "INSERT INTO resolve_traces (trace_id, trace_json, started_at, created_at) VALUES ('trace-schema', ?, ?, ?)",
  ).run(JSON.stringify({ id: "trace-schema", futureField: true }), NOW, NOW);

  expect(repo.get("trace-good")?.title.title).toBe("Show");
  expect(repo.get("trace-bad")).toBeUndefined();
  expect(repo.get("trace-schema")).toBeUndefined();
  expect(repo.listRecent().map((trace) => trace.id)).toEqual(["trace-good"]);
});
