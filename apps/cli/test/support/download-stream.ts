import type { StreamInfo } from "@/domain/types";

/**
 * Enqueue fixtures must carry producer provenance or DownloadService drops the
 * URL before persistence — that is the feature under test. Suites exercising
 * the cached-URL fallback wrap their stream in this so the job records
 * `stream_provider_id` the way a real resolve did.
 */
export function downloadStream(providerId: string, stream: StreamInfo): StreamInfo {
  return {
    ...stream,
    providerResolveResult: {
      providerId,
      status: "resolved",
      streams: [],
      subtitles: [],
      failures: [],
      trace: {
        id: "download-fixture",
        startedAt: "2026-01-01T00:00:00Z",
        title: { id: "tmdb:1", kind: "movie", title: "Fixture" },
        cacheHit: false,
        steps: [],
        failures: [],
      },
    },
  };
}
