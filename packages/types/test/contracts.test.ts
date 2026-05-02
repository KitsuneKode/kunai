import { expect, test } from "bun:test";

import type {
  ProviderModule,
  ProviderResolveResult,
  ProviderRuntimeContext,
  ProviderTraceEvent,
  ResolveTrace,
} from "../src/index";

test("provider resolve result requires trace and immutable candidate arrays", () => {
  const trace: ResolveTrace = {
    id: "trace-1",
    startedAt: "2026-04-29T00:00:00.000Z",
    title: {
      id: "tmdb:1",
      kind: "movie",
      title: "Example",
    },
    cacheHit: false,
    steps: [],
    failures: [],
  };

  const result: ProviderResolveResult = {
    providerId: "vidking",
    streams: [],
    subtitles: [],
    trace,
    failures: [],
  };

  expect(result.trace.id).toBe("trace-1");
  expect(result.streams.length).toBe(0);
});

test("provider sdk contract models selected output plus discovered source inventory", async () => {
  const emitted: ProviderTraceEvent[] = [];
  const context: ProviderRuntimeContext = {
    now: () => "2026-05-01T00:00:00.000Z",
    emit(event) {
      emitted.push(event);
    },
  };

  const module: ProviderModule = {
    providerId: "vidking",
    async resolve(input, runtime) {
      runtime.emit?.({
        type: "source:start",
        at: runtime.now(),
        providerId: "vidking",
        sourceId: "oxygen",
        message: "Trying Oxygen mirror",
      });

      return {
        providerId: "vidking",
        selectedStreamId: "stream-1080p",
        sources: [
          {
            id: "oxygen",
            providerId: "vidking",
            kind: "mirror",
            label: "Oxygen",
            status: "selected",
            confidence: 0.9,
          },
        ],
        variants: [
          {
            id: "oxygen-1080p",
            providerId: "vidking",
            sourceId: "oxygen",
            qualityLabel: "1080p",
            streamIds: ["stream-1080p"],
            selected: true,
            confidence: 0.9,
          },
        ],
        streams: [
          {
            id: "stream-1080p",
            providerId: "vidking",
            sourceId: "oxygen",
            variantId: "oxygen-1080p",
            url: "https://cdn.example/master.m3u8",
            protocol: "hls",
            confidence: 0.9,
            cachePolicy: {
              ttlClass: "stream-manifest",
              scope: "local",
              keyParts: ["provider", "vidking", input.title.id],
            },
          },
        ],
        subtitles: [],
        trace: {
          id: "trace-1",
          startedAt: runtime.now(),
          title: input.title,
          selectedProviderId: "vidking",
          selectedStreamId: "stream-1080p",
          cacheHit: false,
          steps: [],
          events: emitted,
          failures: [],
        },
        failures: [],
      };
    },
  };

  const result = await module.resolve(
    {
      title: { id: "tmdb:1", kind: "movie", title: "Example" },
      mediaKind: "movie",
      intent: "play",
      allowedRuntimes: ["node-fetch"],
    },
    context,
  );

  expect(result.selectedStreamId).toBe("stream-1080p");
  expect(result.sources?.[0]?.kind).toBe("mirror");
  expect(result.variants?.[0]?.qualityLabel).toBe("1080p");
  expect(result.trace.events?.[0]?.type).toBe("source:start");
});
