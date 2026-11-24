import {
  createProviderCachePolicy,
  createResolveTrace,
  createTraceStep,
  defineProviderManifest,
  providerAttemptTimeoutMs,
  providerCycleCandidateTimeoutMs,
  type CoreProviderManifest,
  type CoreProviderModule,
} from "@kunai/core";
import {
  isJsonString,
  ProviderHttpError,
  type CachePolicy,
  type ProviderFailure,
  type ProviderResolveInput,
  type ProviderRuntimeContext,
  type ProviderSourceCandidate,
  type ProviderTraceEvent,
  type ProviderVariantCandidate,
  type StartupPriority,
  type StreamCandidate,
  type SubtitleCandidate,
} from "@kunai/types";

import { resolveTmdbCatalogId } from "../shared/catalog-id";
import { resolveGateBudgetMs, verifyCandidateStream } from "../shared/resolve-gate";
import { createExhaustedResult, emitTraceEvent } from "../shared/resolve-helpers";
import { hasResolvableSeriesCoordinates } from "../shared/series-coordinates";
import {
  createStreamId,
  createVariantId,
  parseSourceHost,
  providerInventorySourceId,
} from "../shared/source-inventory";
import { selectReadyStream } from "../shared/startup-selection";
import { normalizeIsoLanguageCode } from "../shared/subtitle-helpers";
import { createTimeoutSignal } from "../shared/timeout-signal";
import { isImdbTitleId, stremioVideoId, type StremioAddonRef } from "./addon-url";
import { fetchStremioManifest, fetchStremioStreams, sanitizeStremioManifest } from "./client";
import {
  manifestServesStream,
  stremioManifestSchema,
  toDisplayText,
  type StremioContentType,
  type StremioManifest,
} from "./protocol";
import {
  classifyAddonStreams,
  describeUnsupportedAddonStreams,
  type PlayableAddonStream,
} from "./streams";

/** What an addon module asks its host for: the IMDb id of a TMDB title. */
export interface StremioImdbIdRequest {
  readonly tmdbId: number;
  readonly mediaKind: "movie" | "series";
  readonly signal?: AbortSignal;
}

/**
 * Looks an IMDb id up in a catalog that records it against the TMDB id.
 * Resolves `null` when no catalog knows the id, and rejects when the catalogs
 * could not be asked. It never matches by title: a wrong id plays the wrong film.
 */
export type StremioImdbIdResolver = (request: StremioImdbIdRequest) => Promise<string | null>;

export interface StremioAddonModuleOptions {
  readonly addon: StremioAddonRef;
  /** Display name, from the addon's manifest at the time it was added. Defaults to the host. */
  readonly name?: string;
  /**
   * Read on every resolve. Once it returns false the addon is never contacted
   * again in this session, so removing an addon takes effect immediately even
   * though the provider list is rebuilt only at the next start.
   */
  readonly isInstalled?: () => boolean;
  readonly resolveImdbId?: StremioImdbIdResolver;
  /**
   * Called once per session with the addon's validated manifest, the first
   * time it is read. The host uses it to record the addon's own name.
   */
  readonly onManifest?: (manifest: StremioManifest) => void;
}

/** How many ranked streams the resolve gate may probe before giving up. */
const RESOLVE_GATE_MAX_PROBES = 3;
/** Below this a probe cannot reach a verdict, so the walk stops instead of passing blind. */
const RESOLVE_GATE_MIN_PROBE_MS = 750;
/** Share of the attempt the addon's own answers may use; the rest is the gate's. */
const FETCH_PHASE_SHARE = 0.45;
const FETCH_PHASE_MIN_MS = 2_500;
const FETCH_PHASE_MAX_MS = 10_000;

const MANIFEST_CACHE_NAMESPACE = "stremio-addon:manifest";
const MANIFEST_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const IMDB_CACHE_NAMESPACE = "stremio-addon:imdb-id";
const IMDB_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createStremioAddonManifest(
  addon: StremioAddonRef,
  name: string,
): CoreProviderManifest {
  return defineProviderManifest({
    id: addon.providerId,
    displayName: name,
    description: `Stremio addon you added, served from ${addon.host}`,
    domain: addon.host,
    recommended: false,
    mediaKinds: ["movie", "series"],
    capabilities: ["source-resolve", "subtitle-resolve", "multi-source", "quality-ranked"],
    runtimePorts: [
      {
        runtime: "direct-http",
        operations: ["resolve-stream"],
        browserSafe: false,
        relaySafe: false,
        localOnly: false,
      },
    ],
    cachePolicy: {
      ttlClass: "stream-manifest",
      scope: "local",
      keyParts: [
        "provider",
        addon.providerId,
        "media-kind",
        "title",
        "season",
        "episode",
        "subtitle",
        "quality",
        "startup",
      ],
      allowStale: true,
    },
    browserSafe: false,
    // An addon URL can carry the user's own tokens in its path, so requests to
    // it go straight from this machine and are never handed to a relay.
    relaySafe: false,
    catalogIdentity: "tmdb",
    notes: [
      "A community addon installed by the user; Kunai ships none.",
      "Speaks the public Stremio addon protocol over HTTPS. Responses are data: nothing an addon sends is executed.",
      "Titles are asked for by IMDb id, mapped from the TMDB id through a catalog and never guessed from a name.",
      "Only direct http(s) stream URLs become candidates, and each passes the shared resolve gate before it is reported.",
    ],
  });
}

/**
 * One installed addon as a provider in the movie and series lane.
 *
 * The module is built from the manifest URL alone, with no network request, so
 * a slow or dead addon cannot delay startup. The addon's manifest is fetched on
 * the first resolve and cached.
 */
export function createStremioAddonProviderModule(
  options: StremioAddonModuleOptions,
): CoreProviderModule {
  const { addon } = options;
  const name = toDisplayText(options.name, 60) ?? addon.host;
  const manifest = createStremioAddonManifest(addon, name);
  let manifestInMemory: StremioManifest | undefined;

  const loadAddonManifest = async (
    context: ProviderRuntimeContext,
    signal: AbortSignal,
  ): Promise<StremioManifest> => {
    if (manifestInMemory) return manifestInMemory;
    const remember = (loaded: StremioManifest) => {
      manifestInMemory = loaded;
      try {
        options.onManifest?.(loaded);
      } catch {
        // Recording a name is a courtesy; it must never fail a resolve.
      }
      return loaded;
    };
    const cached = stremioManifestSchema.safeParse(
      await context.cache?.read(MANIFEST_CACHE_NAMESPACE, addon.providerId),
    );
    // A competing caller may have committed while this read was in flight.
    if (manifestInMemory) return manifestInMemory;
    if (cached.success) {
      // Sanitizing again covers manifests cached before the scrub existed;
      // on already-clean data it is a no-op.
      return remember(sanitizeStremioManifest(cached.data, addon.manifestUrl));
    }
    const fetched = await fetchStremioManifest(addon, { context, signal });
    // Requests are not joined — a second caller keeps its own signal — but the
    // first answer to land commits; a slower competing fetch must not overwrite
    // the manifest callers already resolved against.
    if (manifestInMemory) return manifestInMemory;
    const committed = remember(fetched);
    await context.cache?.write(
      MANIFEST_CACHE_NAMESPACE,
      addon.providerId,
      committed,
      MANIFEST_CACHE_TTL_MS,
    );
    return committed;
  };

  const lookupImdbId = async (
    input: ProviderResolveInput,
    context: ProviderRuntimeContext,
    signal: AbortSignal,
  ): Promise<{ readonly imdbId: string } | { readonly missing: string }> => {
    const carried = input.title.imdbId ?? input.title.externalIds?.imdbId;
    if (isImdbTitleId(carried)) return { imdbId: carried };

    const tmdbId = resolveTmdbCatalogId(input.title);
    if (tmdbId === null) {
      return { missing: `${name} needs an IMDb or TMDB id, and this title has neither` };
    }
    const mediaKind = input.mediaKind === "movie" ? "movie" : "series";
    const cacheKey = `${mediaKind}:${tmdbId}`;
    const cached = await context.cache?.read<unknown>(IMDB_CACHE_NAMESPACE, cacheKey);
    if (isJsonString(cached) && isImdbTitleId(cached)) return { imdbId: cached };

    let found: string | null | undefined;
    try {
      found = await options.resolveImdbId?.({ tmdbId, mediaKind, signal });
    } catch (cause) {
      if (signal.aborted) throw cause;
      // The catalog could not be asked. That is not "this title has no IMDb
      // id", so it stays retryable and is never cached.
      throw new ProviderHttpError({
        message: `${name} is asked by IMDb id, and the catalog that maps this title to one could not be reached`,
        code: "network-error",
        retryable: true,
        cause,
      });
    }
    if (!isImdbTitleId(found ?? undefined) || !found) {
      return {
        missing: `${name} is asked by IMDb id, and no catalog records one for this title`,
      };
    }
    await context.cache?.write(IMDB_CACHE_NAMESPACE, cacheKey, found, IMDB_CACHE_TTL_MS);
    return { imdbId: found };
  };

  return {
    providerId: addon.providerId,
    manifest,
    async resolve(input, context) {
      const providerId = addon.providerId;
      if (input.mediaKind !== "movie" && input.mediaKind !== "series") {
        return createExhaustedResult(input, context, providerId, {
          code: "unsupported-title",
          message: `${name} is used for movies and series only`,
          retryable: false,
        });
      }
      if (!input.allowedRuntimes.includes("direct-http")) {
        return createExhaustedResult(input, context, providerId, {
          code: "runtime-missing",
          message: `${name} requires the direct-http runtime`,
          retryable: false,
        });
      }
      if (options.isInstalled && !options.isInstalled()) {
        return createExhaustedResult(input, context, providerId, {
          code: "unsupported-title",
          message: `${name} was removed and is no longer asked for streams`,
          retryable: false,
        });
      }
      const coordinates = input.mediaKind === "series" ? input.episode : undefined;
      if (input.mediaKind === "series" && !hasResolvableSeriesCoordinates(coordinates)) {
        return createExhaustedResult(input, context, providerId, {
          code: "unsupported-title",
          message: `${name} requires season and episode for series`,
          retryable: false,
        });
      }

      const startedAt = context.now();
      const startedMs = Date.parse(startedAt);
      const startupPriority = input.startupPriority ?? "balanced";
      // The engine abandons the attempt at its own timeout. Working inside the
      // shared ceiling below it means a slow addon ends as a failure this module
      // reports, not as an attempt killed with nothing attributable in the trace.
      const attemptBudgetMs = providerCycleCandidateTimeoutMs(startupPriority);
      const remainingMs = () => attemptBudgetMs - (Date.parse(context.now()) - startedMs);
      const events: ProviderTraceEvent[] = [];
      const failures: ProviderFailure[] = [];
      const cachePolicy = createProviderCachePolicy({
        providerId,
        title: input.title,
        episode: input.episode,
        subtitleLanguage: input.preferredSubtitleLanguage,
        qualityPreference: input.qualityPreference,
        startupPriority: input.startupPriority,
      });
      const evidence = { cachePolicy, events, failures, startedAt };
      const exhausted = (failure: Omit<ProviderFailure, "providerId" | "at">) => {
        failures.push({ ...failure, providerId, at: context.now() });
        return createExhaustedResult(input, context, providerId, failure, evidence);
      };

      emitTraceEvent(events, context, {
        type: "provider:start",
        providerId,
        message: `Asking Stremio addon ${name}`,
        attributes: { addonHost: addon.host },
      });

      let playable: readonly PlayableAddonStream[];
      let unsupportedSummary = "";
      try {
        const fetchSignal = createTimeoutSignal(
          context.signal,
          fetchPhaseBudgetMs(startupPriority),
        );
        const identity = await lookupImdbId(input, context, fetchSignal);
        if ("missing" in identity) {
          return exhausted({
            code: "unsupported-title",
            message: identity.missing,
            retryable: false,
          });
        }

        const type: StremioContentType = input.mediaKind;
        const videoId = stremioVideoId(
          identity.imdbId,
          hasResolvableSeriesCoordinates(coordinates) ? coordinates : undefined,
        );
        const addonManifest = await loadAddonManifest(context, fetchSignal);
        if (addonManifest.behaviorHints?.configurationRequired === true) {
          return exhausted({
            code: "missing-input",
            message: `${name} must be configured on its own page first; add the manifest URL it gives you after that`,
            retryable: false,
          });
        }
        const serves = manifestServesStream(addonManifest, type, videoId);
        if (!serves.served) {
          return exhausted({
            code: "unsupported-title",
            message: `${name}: ${serves.reason}`,
            retryable: false,
          });
        }

        const listing = await fetchStremioStreams(addon, type, videoId, {
          context,
          signal: fetchSignal,
        });
        const classified = classifyAddonStreams(listing.entries, addon.manifestUrl);
        playable = classified.playable;
        unsupportedSummary = describeUnsupportedAddonStreams(classified.unsupported);
        if (classified.unsupportedTotal > 0 || listing.truncated > 0) {
          emitTraceEvent(events, context, {
            type: "source:skipped",
            providerId,
            message: `${name} offered streams Kunai cannot play: ${unsupportedSummary || "none"}${
              listing.truncated > 0 ? `; ${listing.truncated} more were not read` : ""
            }`,
            attributes: {
              ...classified.unsupported,
              unsupported: classified.unsupportedTotal,
              notRead: listing.truncated,
            },
          });
        }
      } catch (error) {
        if (context.signal?.aborted) {
          return createExhaustedResult(input, context, providerId, {
            code: "cancelled",
            message: `${name} resolution was cancelled`,
            retryable: false,
          });
        }
        const httpError = error instanceof ProviderHttpError ? error : undefined;
        emitTraceEvent(events, context, {
          type: "source:failed",
          providerId,
          message: `${name} did not answer`,
          attributes: { code: httpError?.code ?? "network-error" },
        });
        return exhausted({
          code: httpError?.code ?? "network-error",
          message: httpError?.message ?? `${name} could not be asked for streams`,
          retryable: httpError?.retryable ?? true,
        });
      }

      // A transport that answered despite the cancel still must not be read as
      // "the addon has nothing": the answer was never wanted.
      if (context.signal?.aborted) {
        return createExhaustedResult(
          input,
          context,
          providerId,
          { code: "cancelled", message: `${name} resolution was cancelled`, retryable: false },
          evidence,
        );
      }
      if (playable.length === 0) {
        return exhausted({
          code: "not-found",
          message: unsupportedSummary
            ? `${name} has no stream Kunai can play for this title (it offered ${unsupportedSummary})`
            : `${name} has no streams for this title`,
          retryable: false,
        });
      }

      const remaining = playable.map((stream) =>
        toStreamCandidate(stream, { addon, name, cachePolicy }),
      );
      // Addons list streams in their own preferred order, which the user sets on
      // the addon's page. That order is kept unless the user pinned a source or a
      // quality here, or asked for quality first. The selection is re-run after
      // every probe so the next pick is the best *remaining* candidate — under
      // quality-first a dead 2160p falls through to 1440p, not to whatever
      // trailed the first pick in provider order.
      const selection = {
        startupPriority,
        qualityPreference: input.qualityPreference,
        preferredStreamId: input.preferredStreamId,
        preferredSourceId: input.preferredSourceId,
        favoriteSourceNames: input.favoriteSourceNames,
        preferProviderReadyOrder: true,
      } satisfies Parameters<typeof selectReadyStream>[1];
      const firstPick = remaining.length > 0 ? selectReadyStream(remaining, selection) : undefined;

      // Only a verified stream may be reported. An addon is untrusted input:
      // a candidate the gate merely could not disprove (inconclusive) or never
      // reached (past the probe cap) stays out of the inventory, or a later
      // selection could hand the player a URL the gate never cleared.
      const verifiedStreams: StreamCandidate[] = [];
      let gateFailure: Omit<ProviderFailure, "providerId" | "at"> | undefined;
      for (
        let attempt = 0;
        attempt < RESOLVE_GATE_MAX_PROBES && remaining.length > 0;
        attempt += 1
      ) {
        if (context.signal?.aborted) break;
        const probeBudgetMs = resolveGateBudgetMs(remainingMs());
        // Out of time for a probe that can reach a verdict. Only the first
        // attempt is exempt: the fetch-phase bound always leaves it room.
        if (probeBudgetMs < RESOLVE_GATE_MIN_PROBE_MS && attempt > 0) break;
        const { selected: candidate } = selectReadyStream(remaining, selection);
        remaining.splice(remaining.indexOf(candidate), 1);

        const verdict = await verifyCandidateStream({
          stream: candidate,
          context,
          timeoutMs: probeBudgetMs,
          requireDirectMedia: true,
        });
        // An abort that landed mid-probe makes its result meaningless.
        if (context.signal?.aborted) break;
        if (verdict.accepted && verdict.verified) {
          verifiedStreams.push(candidate);
          continue;
        }

        const probeStatus = verdict.accepted ? "inconclusive" : (verdict.probe?.status ?? "failed");
        gateFailure ??= {
          code: probeStatus === "timeout" ? "timeout" : "not-found",
          message: `${addon.host} did not provide a verified stream`,
          retryable: true,
        };
        emitTraceEvent(events, context, {
          type: "source:failed",
          providerId,
          sourceId: candidate.sourceId,
          streamId: candidate.id,
          message: `${addon.host} resolve-gate probe failed`,
          // The status word only — never the verdict reason, which can quote
          // the probed URL or the response body.
          attributes: { reason: probeStatus },
        });
      }

      const selectedStream = context.signal?.aborted ? undefined : verifiedStreams[0];
      if (!selectedStream) {
        if (context.signal?.aborted) {
          return createExhaustedResult(
            input,
            context,
            providerId,
            { code: "cancelled", message: `${name} resolve was cancelled`, retryable: false },
            evidence,
          );
        }
        return exhausted(
          gateFailure ?? {
            code: "not-found",
            message: `${name} offered no stream that could be verified`,
            retryable: true,
          },
        );
      }

      const subtitles = toSubtitleCandidates(playable, verifiedStreams, providerId, cachePolicy);
      const sources = toSourceCandidates(verifiedStreams, selectedStream, cachePolicy);
      const variants = verifiedStreams.map<ProviderVariantCandidate>((stream) => ({
        id: stream.variantId ?? stream.id,
        providerId,
        sourceId: stream.sourceId ?? sources[0]?.id ?? providerId,
        label: [stream.qualityLabel, stream.flavorLabel].filter(Boolean).join(" · ") || "auto",
        qualityLabel: stream.qualityLabel,
        qualityRank: stream.qualityRank,
        dynamicRange: stream.dynamicRange,
        protocol: stream.protocol,
        container: stream.container,
        flavorLabel: stream.flavorLabel,
        streamIds: [stream.id],
        subtitleIds: subtitles
          .filter((subtitle) => subtitle.variantId === stream.variantId)
          .map((subtitle) => subtitle.id),
        selected: stream.id === selectedStream.id,
        confidence: stream.confidence,
        metadata: stream.metadata,
      }));

      emitTraceEvent(events, context, {
        type: "provider:success",
        providerId,
        sourceId: selectedStream.sourceId,
        streamId: selectedStream.id,
        message: `Stremio addon ${name} resolved ${verifiedStreams.length} stream(s)`,
        attributes: { addonHost: addon.host, streams: verifiedStreams.length },
      });

      const endedAt = context.now();
      return {
        status: "resolved",
        providerId,
        selectedStreamId: selectedStream.id,
        streamReachabilityVerified: true,
        selectionDecision:
          firstPick?.selected.id === selectedStream.id ? firstPick.decision : undefined,
        sources,
        streams: verifiedStreams,
        variants,
        subtitles,
        cachePolicy,
        trace: createResolveTrace({
          title: input.title,
          episode: input.episode,
          providerId,
          streamId: selectedStream.id,
          cacheHit: false,
          runtime: "direct-http",
          startedAt,
          endedAt,
          steps: [
            createTraceStep("provider", `Resolved by Stremio addon ${name} (${addon.host})`, {
              providerId,
              attributes: {
                addonHost: addon.host,
                streams: verifiedStreams.length,
                subtitles: subtitles.length,
              },
            }),
          ],
          events,
          failures,
        }),
        failures,
        healthDelta: { providerId, outcome: "success", at: endedAt },
      };
    },
  };
}

function fetchPhaseBudgetMs(startupPriority: StartupPriority): number {
  const share = Math.floor(providerAttemptTimeoutMs(startupPriority) * FETCH_PHASE_SHARE);
  return Math.max(FETCH_PHASE_MIN_MS, Math.min(FETCH_PHASE_MAX_MS, share));
}

/** "Addon" alone when the stream's own name already says it, else "Addon · stream name". */
function sourceLabel(addonName: string, streamName: string | undefined): string {
  if (!streamName) return addonName;
  return streamName.toLowerCase().includes(addonName.toLowerCase())
    ? streamName
    : `${addonName} · ${streamName}`;
}

/**
 * A candidate id for the request actually shipped: the URL plus its outgoing
 * headers, hashed — headers can carry addon tokens, so the key itself is never
 * published, only its hash.
 */
function addonStreamId(providerId: string, stream: PlayableAddonStream): string {
  return createStreamId(providerId, [Bun.hash(stream.requestKey).toString(36)]);
}

function toStreamCandidate(
  stream: PlayableAddonStream,
  owner: {
    readonly addon: StremioAddonRef;
    readonly name: string;
    readonly cachePolicy: CachePolicy;
  },
): StreamCandidate {
  const { providerId } = owner.addon;
  // Streams sharing a binge group are interchangeable across episodes, so the
  // group is the source: a source remembered for one episode finds the same
  // release on the next. Streams without one share a single source.
  const sourceId = providerInventorySourceId(providerId, stream.bingeGroup ?? "streams");
  const label = sourceLabel(owner.name, stream.name);
  const id = addonStreamId(providerId, stream);
  return {
    id,
    providerId,
    sourceId,
    variantId: createVariantId(providerId, [sourceId, stream.qualityLabel, id]),
    url: stream.url,
    protocol: stream.protocol,
    container: stream.container,
    qualityLabel: stream.qualityLabel,
    qualityRank: stream.qualityRank,
    dynamicRange: stream.dynamicRange,
    serverName: label,
    flavorLabel: label,
    ...(stream.headers ? { headers: stream.headers } : null),
    confidence: stream.qualityRank > 0 ? 0.85 : 0.75,
    cachePolicy: owner.cachePolicy,
    metadata: {
      stremioAddon: owner.name,
      stremioAddonHost: owner.addon.host,
      ...(stream.description ? { description: stream.description } : null),
      ...(stream.filename ? { filename: stream.filename } : null),
      ...(stream.bingeGroup ? { bingeGroup: stream.bingeGroup } : null),
      ...(stream.videoSizeBytes !== undefined ? { videoSizeBytes: stream.videoSizeBytes } : null),
      ...(stream.notWebReady ? { notWebReady: true } : null),
    },
  };
}

function toSourceCandidates(
  streams: readonly StreamCandidate[],
  selected: StreamCandidate,
  cachePolicy: CachePolicy,
): ProviderSourceCandidate[] {
  const sources = new Map<string, ProviderSourceCandidate>();
  for (const stream of streams) {
    if (!stream.sourceId || sources.has(stream.sourceId)) continue;
    sources.set(stream.sourceId, {
      id: stream.sourceId,
      providerId: stream.providerId,
      kind: "provider-api",
      label: stream.flavorLabel,
      host: parseSourceHost(stream.url),
      status: stream.sourceId === selected.sourceId ? "selected" : "available",
      confidence: stream.confidence,
      requiresRuntime: "direct-http",
      cachePolicy,
      metadata: {
        stremioAddon: stream.metadata?.stremioAddon,
        stremioAddonHost: stream.metadata?.stremioAddonHost,
      },
    });
  }
  return [...sources.values()];
}

function toSubtitleCandidates(
  playable: readonly PlayableAddonStream[],
  streams: readonly StreamCandidate[],
  providerId: string,
  cachePolicy: CachePolicy,
): SubtitleCandidate[] {
  const streamById = new Map(streams.map((stream) => [stream.id, stream]));
  const subtitles: SubtitleCandidate[] = [];
  for (const source of playable) {
    const stream = streamById.get(addonStreamId(providerId, source));
    if (!stream) continue;
    // Dedup is per variant: the same subtitle URL offered by two verified
    // variants is two candidates, one resolving to each variant.
    const seen = new Set<string>();
    for (const subtitle of source.subtitles) {
      if (seen.has(subtitle.url)) continue;
      seen.add(subtitle.url);
      const lower = subtitle.url.toLowerCase();
      subtitles.push({
        id: `subtitle:${providerId}:${stream.variantId}:${Bun.hash(subtitle.url).toString(36)}`,
        providerId,
        sourceId: stream.sourceId,
        variantId: stream.variantId,
        url: subtitle.url,
        language: normalizeIsoLanguageCode(subtitle.language),
        label: subtitle.language,
        format: lower.includes(".vtt")
          ? "vtt"
          : lower.includes(".srt")
            ? "srt"
            : lower.includes(".ass")
              ? "ass"
              : "unknown",
        source: "provider",
        confidence: 0.8,
        cachePolicy: {
          ...cachePolicy,
          ttlClass: "subtitle-list",
          keyParts: [...cachePolicy.keyParts, "subtitles"],
        },
      });
    }
  }
  return subtitles;
}
