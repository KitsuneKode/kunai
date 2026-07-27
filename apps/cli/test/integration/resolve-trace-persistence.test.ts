import { describe, expect, test } from "bun:test";

import { createResolveTraceStub, finalizeResolveTrace } from "@/app/playback/resolve-trace";
import type { TitleInfo } from "@/domain/types";
import { ResolveTraceSink } from "@/services/diagnostics/ResolveTraceSink";
import { openKunaiDatabase, ResolveTraceRepository, runMigrations } from "@kunai/storage";

/**
 * The sink deliberately swallows storage faults so telemetry can never fail a
 * playback. That makes a schema mismatch silent: traces would simply never
 * appear and nothing would say why. These tests close that gap by driving a
 * finalized trace through the real repository and a real migrated database.
 */

const title: TitleInfo = { id: "550", name: "Fight Club", type: "movie", year: "1999" };

function sinkOverRealDb() {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "cache");
  const repository = new ResolveTraceRepository(db);
  return { sink: new ResolveTraceSink(repository), repository };
}

describe("resolve trace persistence", () => {
  test("a finalized trace survives the real schema and reads back", () => {
    const { sink, repository } = sinkOverRealDb();
    const trace = createResolveTraceStub({
      title,
      providerId: "videasy",
      mode: "series",
    });

    sink.record(
      finalizeResolveTrace(trace, {
        endedAt: "2026-07-28T12:00:05.000Z",
        selectedProviderId: "vidlink",
        selectedStreamId: "stream-1",
        cacheHit: false,
        failures: [
          {
            providerId: "videasy",
            code: "timeout",
            message: "candidate timed out",
            retryable: false,
            at: "2026-07-28T12:00:03.000Z",
          },
        ],
      }),
    );

    const stored = repository.get(trace.id);
    expect(stored).toBeDefined();
    expect(stored?.selectedProviderId).toBe("vidlink");
    expect(stored?.selectedStreamId).toBe("stream-1");
    expect(stored?.endedAt).toBe("2026-07-28T12:00:05.000Z");
    expect(stored?.failures).toHaveLength(1);
    expect(repository.listRecent(10)).toHaveLength(1);
  });

  test("a failed resolve is recorded, not dropped", () => {
    // The most valuable trace is the one where nothing resolved.
    const { sink, repository } = sinkOverRealDb();
    const trace = createResolveTraceStub({ title, providerId: "videasy", mode: "series" });

    sink.record(
      finalizeResolveTrace(trace, {
        endedAt: "2026-07-28T12:00:09.000Z",
        cacheHit: false,
        failures: [],
      }),
    );

    const stored = repository.get(trace.id);
    expect(stored?.selectedStreamId).toBeUndefined();
    expect(stored?.endedAt).toBe("2026-07-28T12:00:09.000Z");
  });

  test("recording the same resolve twice does not duplicate it", () => {
    const { sink, repository } = sinkOverRealDb();
    const trace = createResolveTraceStub({ title, providerId: "videasy", mode: "series" });
    const finished = finalizeResolveTrace(trace, {
      endedAt: "2026-07-28T12:00:05.000Z",
      cacheHit: true,
      failures: [],
    });

    sink.record(finished);
    sink.record(finished);

    expect(repository.listRecent(10)).toHaveLength(1);
  });
});
