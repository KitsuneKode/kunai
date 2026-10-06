import { afterEach, expect, test } from "bun:test";

import {
  DiagnosticEventsRepository,
  ProviderEndpointHealthRepository,
  ProviderHealthRepository,
  ResolveTraceRepository,
  SourceInventoryRepository,
  StreamCacheRepository,
  SyncOutboxRepository,
  SyncReconciliationRepository,
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

test("source inventory: a poisoned row is evicted and treated as a miss", () => {
  const db = stores.store("poison-source-inventory", "cache");
  const repo = new SourceInventoryRepository(db);
  repo.set(
    "good-key",
    "vidlink",
    "tmdb:1",
    { sources: [{ id: "src-1", name: "Source 1" }] },
    "2099-01-01T00:00:00.000Z",
  );
  db.query(
    `INSERT INTO source_inventory
       (inventory_key, provider_id, title_id, inventory_json, expires_at, created_at, last_accessed_at)
     VALUES ('bad-key', 'vidlink', 'tmdb:1', 'not-valid-json', '2099-01-01T00:00:00.000Z', ?, ?)`,
  ).run(NOW, NOW);
  db.query(
    `INSERT INTO source_inventory
       (inventory_key, provider_id, title_id, inventory_json, expires_at, created_at, last_accessed_at)
     VALUES ('bad-schema', 'vidlink', 'tmdb:1', '{"sources": 123}', '2099-01-01T00:00:00.000Z', ?, ?)`,
  ).run(NOW, NOW);

  expect(repo.get("good-key")?.inventory).toEqual({ sources: [{ id: "src-1", name: "Source 1" }] });
  expect(repo.get("bad-key")).toBeUndefined();
  expect(repo.get("bad-schema")).toBeUndefined();

  const remaining = db
    .query<{ inventory_key: string }, []>("SELECT inventory_key FROM source_inventory")
    .all()
    .map((row) => row.inventory_key);
  expect(remaining).toEqual(["good-key"]);
});

test("sync outbox: a poisoned payload_json claims as undefined instead of wedging the queue", () => {
  const db = stores.store("poison-sync-outbox", "data");
  const repo = new SyncOutboxRepository(db);
  repo.enqueue(
    {
      trackerId: "anilist",
      dedupeKey: "good-intent",
      payload: { kind: "list:add", item: { titleId: "tmdb:1" } },
    },
    new Date(NOW),
  );
  db.query(
    `INSERT INTO sync_outbox
       (id, tracker_id, dedupe_key, payload_json, generation, attempts, state,
        next_attempt_at, created_at, updated_at)
     VALUES ('poison-row', 'anilist', 'poisoned', 'not json{', 1, 0, 'pending', ?, ?, ?)`,
  ).run(NOW, NOW, NOW);
  // Valid JSON that is not an object answers NULL to every json_extract term —
  // it used to suppress the upsert and silently drop fresh intent.
  db.query(
    `INSERT INTO sync_outbox
       (id, tracker_id, dedupe_key, payload_json, generation, attempts, state,
        next_attempt_at, created_at, updated_at)
     VALUES ('scalar-row', 'tmdb', 'scalar', '5', 1, 0, 'pending', ?, ?, ?)`,
  ).run(NOW, NOW, NOW);

  const claims = repo.claimDue(10, new Date("2026-08-16T00:01:00.000Z"));
  expect(claims.map((c) => c.dedupeKey).sort()).toEqual(["good-intent", "poisoned", "scalar"]);
  const poisoned = claims.find((c) => c.dedupeKey === "poisoned");
  expect(poisoned?.payload).toBeUndefined();
  expect(claims.find((c) => c.dedupeKey === "good-intent")?.payload).toEqual({
    kind: "list:add",
    item: { titleId: "tmdb:1" },
  });
});

test("sync outbox: enqueue supersedes a stored row whose payload cannot answer the comparison", () => {
  const db = stores.store("poison-sync-outbox-enqueue", "data");
  const repo = new SyncOutboxRepository(db);
  const next = { kind: "progress:set", progress: 4, status: "watching" };

  for (const [dedupeKey, payloadJson] of [
    ["was-malformed", "not json{"],
    ["was-scalar", "5"],
    ["was-array", "[1,2]"],
  ] as const) {
    db.query(
      `INSERT INTO sync_outbox
         (id, tracker_id, dedupe_key, payload_json, generation, attempts, state,
          next_attempt_at, created_at, updated_at)
       VALUES (?, 'anilist', ?, ?, 1, 0, 'pending', ?, ?, ?)`,
    ).run(`row-${dedupeKey}`, dedupeKey, payloadJson, NOW, NOW, NOW);
  }

  for (const dedupeKey of ["was-malformed", "was-scalar", "was-array"]) {
    const stored = repo.enqueue({ trackerId: "anilist", dedupeKey, payload: next }, new Date(NOW));
    expect(stored.payload).toEqual(next);
    expect(stored.generation).toBe(2);
  }
});

test("sync reconciliation: poisoned payload rows are skipped by listings and purged", () => {
  const db = stores.store("poison-sync-reconciliation", "data");
  const repo = new SyncReconciliationRepository(db);
  repo.record({ kind: "history", historyKey: "h-good", localMutationId: "mut-1" }, new Date(NOW));
  for (const [id, json] of [
    ["poison-1", "not json{"],
    ["poison-2", "5"],
  ] as const) {
    db.query(
      `INSERT INTO sync_reconciliation
         (id, mutation_kind, entity_key, payload_json, generation, attempt_count,
          next_attempt_at, created_at, updated_at)
       VALUES (?, 'history', ?, ?, 1, 0, ?, ?, ?)`,
    ).run(id, `ek-${id}`, json, NOW, NOW, NOW);
  }

  const due = repo.listDue(new Date("2026-08-16T00:01:00.000Z"));
  expect(due.map((r) => r.id)).toHaveLength(1);
  expect(repo.listPending().map((r) => r.id)).toHaveLength(1);

  expect(repo.purgeUnprojectable()).toBe(2);
  expect(repo.purgeUnprojectable()).toBe(0);
  expect(repo.listPending()).toHaveLength(1);
});

test("diagnostic events: a poisoned context_json reads as absent instead of crashing the list", () => {
  const db = stores.store("poison-diagnostic-events", "cache");
  const repo = new DiagnosticEventsRepository(db);
  repo.insert({
    timestamp: NOW,
    level: "warn",
    category: "playback",
    operation: "playback.test",
    message: "good event",
    context: { detail: "kept" },
  });
  db.query(
    `INSERT INTO diagnostic_events
       (timestamp, level, category, operation, message, context_json, created_at)
     VALUES (?, 'warn', 'playback', 'playback.test', 'bad event', 'not json{', ?)`,
  ).run(NOW, NOW);

  const events = repo.listRecent(10);
  expect(events).toHaveLength(2);
  const bad = events.find((e) => e.message === "bad event");
  expect(bad?.context).toBeUndefined();
  const good = events.find((e) => e.message === "good event");
  expect(good?.context).toEqual({ detail: "kept" });
});
