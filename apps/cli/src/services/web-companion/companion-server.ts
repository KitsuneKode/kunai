import type { Container } from "@/container/types";
import { mediaLanguageProfileFor } from "@/domain/media/content-kind";
import { normalizeSearchIntent } from "@/domain/search/SearchIntent";
import type { EpisodeInfo, StreamInfo } from "@/domain/types";
import { createStreamGateway, type StreamGatewayDocument } from "@/infra/player/stream-gateway";
import { materializeDeferredMediaDocument } from "@/services/playback/deferred-media-materializer";
import { searchTitles } from "@/services/search/SearchRoutingService";
import { fetchSeriesData } from "@/tmdb";
import { renderWebCompanionHtml } from "@kunai/relay";
import { isJsonObject, type JsonValue } from "@kunai/types";
import { z } from "zod";

import { readCompanionBody } from "./companion-body";
import {
  parseCompanionLane,
  posterUrlForSearchResult,
  shellModeForLane,
  titleInfoFromSearchResult,
  type CompanionCatalogEntry,
} from "./companion-catalog";
import { CompanionRunState } from "./companion-run";
import {
  isCompanionApiPath,
  readCompanionCredential,
  validateCompanionRequestHost,
  validateCompanionRequestOrigin,
} from "./companion-session";
export { CompanionRunState } from "./companion-run";

function json(data: JsonValue, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
}
function coordinate(value: JsonValue | undefined, maximum: number, integer = true): number | null {
  const parsed = z
    .union([
      z.number(),
      z
        .string()
        .regex(/^\d+(?:\.\d+)?$/)
        .transform(Number),
    ])
    .pipe(z.number().positive().max(maximum))
    .refine((number) => !integer || Number.isInteger(number))
    .optional()
    .default(1)
    .safeParse(value);
  return parsed.success ? parsed.data : null;
}
function profileFor(container: Container, entry: CompanionCatalogEntry) {
  return mediaLanguageProfileFor({
    mode: entry.mode,
    currentTitle: entry.title,
    animeLanguageProfile: container.config.animeLanguageProfile,
    seriesLanguageProfile: container.config.seriesLanguageProfile,
    movieLanguageProfile: container.config.movieLanguageProfile,
    youtubeLanguageProfile: container.config.youtubeLanguageProfile,
  });
}

/** Browser sessions use the same guarded request and token revocation as Android. */
async function gatewayFor(
  stream: StreamInfo,
  run: CompanionRunState,
  signal: AbortSignal,
  browserOrigin: string,
) {
  if (stream.requiresYtdl) return null;
  let document: StreamGatewayDocument | undefined;
  let cleanup: (() => Promise<void>) | undefined;
  try {
    if (stream.deferredLocator) {
      const materialized = await materializeDeferredMediaDocument(stream);
      cleanup = materialized.cleanup;
      document = {
        text: materialized.text,
        contentType: materialized.contentType,
        remoteUrls: materialized.remoteUrls,
      };
    }
    signal.throwIfAborted();
    if (!run.gateway || run.gateway.isStopped())
      run.gateway = createStreamGateway({ browserOrigin });
    const subtitles = [
      ...new Set(
        [
          ...(stream.subtitle ? [stream.subtitle] : []),
          ...(stream.subtitleList ?? [])
            .filter((t) => t.sourceKind !== "embedded")
            .map((t) => t.url),
        ].filter(Boolean),
      ),
    ];
    const session = run.gateway.registerSession({
      url: document ? undefined : stream.url,
      headers: stream.headers,
      subtitles,
      document,
    });
    run.gatewayStop?.();
    run.gatewayStop = () => {
      session.stop();
      void cleanup?.().catch(() => {});
    };
    return session;
  } catch (error) {
    await cleanup?.();
    throw error;
  }
}

/** Authenticated HTTP boundary; the runtime ports remain the real catalog/resolve/player services. */
export function createCompanionFetchHandler(input: {
  readonly container: Container;
  readonly run: CompanionRunState;
  readonly runSecret: string;
  readonly bindHost: string;
  readonly bindPort: number;
}): (request: Request) => Promise<Response> {
  const { container, run } = input;
  const managedPlayer = container.player.capabilities.observation === "managed";
  const boundUrl = new URL(`http://${input.bindHost}:${input.bindPort}`);
  const origin = boundUrl.origin;
  const expectedHost = boundUrl.host;

  const resolve = async (
    entry: CompanionCatalogEntry,
    episode: EpisodeInfo,
    signal: AbortSignal,
  ) => {
    const profile = profileFor(container, entry);
    return container.playbackResolveWork.resolve(
      {
        title: entry.title,
        episode,
        mode: entry.mode,
        providerId: entry.providerId,
        audioPreference: profile.audio,
        subtitlePreference: profile.subtitle,
        qualityPreference: profile.quality,
        signal,
      },
      { intentKind: "playback", budgetLane: "user-blocking" },
    );
  };

  return async (request) => {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (!validateCompanionRequestHost(request, expectedHost))
      return json({ error: "Forbidden" }, 403);
    if ((path === "/" || path === "/app") && method === "GET")
      return new Response(renderWebCompanionHtml({ serviceName: "Kunai Companion" }), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
          "X-Frame-Options": "DENY",
        },
      });
    if (path === "/manifest.json" && method === "GET")
      return json({
        name: "Kunai Companion",
        short_name: "Kunai",
        start_url: "/",
        display: "standalone",
        description: "Local Kunai companion for this device.",
      });
    if (path === "/health" && method === "GET")
      return json({ ok: true, service: "kunai-web-companion" });
    if (!isCompanionApiPath(path)) return new Response("Not found", { status: 404 });
    if (!validateCompanionRequestOrigin(request, origin)) return json({ error: "Forbidden" }, 403);
    if (path !== "/api/session" && readCompanionCredential(request) !== input.runSecret)
      return json({ error: "Forbidden" }, 403);
    if (
      (["/api/session", "/api/control", "/api/release"].includes(path) && method !== "POST") ||
      (["/api/status", "/api/search", "/api/episodes", "/api/stream"].includes(path) &&
        method !== "GET")
    )
      return json({ error: "Method not allowed" }, 405);
    try {
      if (path === "/api/session") {
        const parsed = z.object({ token: z.string() }).safeParse(await readCompanionBody(request));
        if (!parsed.success) return json({ error: "Invalid session" }, 400);
        if (parsed.data.token !== input.runSecret) return json({ error: "Forbidden" }, 403);
        return json({ ok: true });
      }
      if (path === "/api/release") {
        const parsed = z
          .object({ mediaId: z.string().regex(/^[0-9a-f]{32}$/) })
          .safeParse(await readCompanionBody(request));
        if (!parsed.success) return json({ error: "Invalid media session" }, 400);
        return json({ ok: true, released: run.releaseMedia(parsed.data.mediaId) });
      }
      if (path === "/api/status") {
        const disabled = new Set(container.config.disabledProviders ?? []);
        return json({
          ok: true,
          providers: container.providerRegistry.getAllRegistered().map((p) => ({
            id: p.metadata.id,
            name: p.metadata.name,
            lane: p.metadata.providerLane,
            enabled: !disabled.has(p.metadata.id),
            status: "unknown",
          })),
          playback: run.playback,
          controls:
            managedPlayer || run.playback.state === "starting" ? ["play", "stop"] : ["play"],
        });
      }
      if (path === "/api/search") {
        const query = (url.searchParams.get("q") ?? "").trim();
        const lane = parseCompanionLane(url.searchParams.get("lane"));
        if (!lane || query.length > 200) return json({ error: "Invalid search" }, 400);
        if (!query) return json({ ok: true, results: [] });
        const work = run.beginWork("search", request.signal);
        const mode = shellModeForLane(lane);
        const provider = container.providerRegistry.getDefaultForMode(mode);
        const routed = await searchTitles(
          normalizeSearchIntent({
            query,
            mode: lane === "movies" ? "movie" : mode,
            filters: {},
            sort: "relevance",
          }),
          {
            mode,
            providerId: provider.metadata.id,
            animeLanguageProfile: container.config.animeLanguageProfile,
            youtubeLanguageProfile: container.config.youtubeLanguageProfile,
            signal: work.signal,
            searchRegistry: container.searchRegistry,
            providerRegistry: container.providerRegistry,
            enrichAnimeMetadata: false,
          },
        );
        work.signal.throwIfAborted();
        if (!run.isAlive("search", work.controller))
          return json({ error: "Request cancelled" }, 409);
        const source = container.providerRegistry.get(routed.sourceId);
        const providerId = source?.metadata.id ?? provider.metadata.id;
        return json({
          ok: true,
          results: routed.results.slice(0, 100).map((result) => ({
            id: run.catalog.put({
              title: titleInfoFromSearchResult(result),
              providerId,
              mode,
              lane,
              result,
            }),
            title: result.title,
            year: result.year,
            type: result.type,
            posterUrl: posterUrlForSearchResult(result),
            providerId,
          })),
        });
      }
      let body: JsonValue = {};
      if (path === "/api/control") {
        body = await readCompanionBody(request);
        if (!isJsonObject(body)) return json({ error: "Invalid control request" }, 400);
        if (body.action === "stop") {
          if (!managedPlayer && run.playback.state !== "starting")
            return json({ error: "Use the external app to stop playback." }, 409);
          const pending = run.stopPlayback();
          const stopped =
            managedPlayer && (await container.playerControl.stopCurrentPlayback("companion-stop"));
          return pending || stopped
            ? json({ ok: true, action: "stop" })
            : json({ error: "Nothing to stop" }, 409);
        }
        if (body.action !== "play") return json({ error: "Unsupported action" }, 400);
      }
      const control = isJsonObject(body) ? body : {};
      const rawId =
        path === "/api/control"
          ? control.titleId
          : url.searchParams.get(path === "/api/episodes" ? "id" : "titleId");
      const rawLane = path === "/api/control" ? control.lane : url.searchParams.get("lane");
      const lane = parseCompanionLane(z.string().safeParse(rawLane).data ?? null);
      const id = z.string().safeParse(rawId).data ?? "";
      const entry = run.catalog.get(id);
      const season = coordinate(
        path === "/api/control" ? control.season : (url.searchParams.get("season") ?? undefined),
        500,
      );
      const number = coordinate(
        path === "/api/control" ? control.episode : (url.searchParams.get("episode") ?? undefined),
        100_000,
        false,
      );
      if (!lane || season === null || number === null)
        return json({ error: "Invalid request" }, 400);
      if (!entry) return json({ error: "Unknown or expired title. Search again." }, 404);
      if (entry.lane !== lane) return json({ error: "Title belongs to another mode" }, 400);
      const single = entry.title.type === "movie" || entry.mode === "youtube";
      if (path === "/api/episodes") {
        if (single)
          return json({ ok: true, episodes: [{ number: 1, title: "Play Title", season: 1 }] });
        const work = run.beginWork("episodes", request.signal);
        const profile = profileFor(container, entry);
        const provider = container.providerRegistry.get(entry.providerId);
        const listed = await provider?.listEpisodes?.(
          {
            title: entry.title,
            audioPreference: profile.audio,
            subtitlePreference: profile.subtitle,
          },
          work.signal,
        );
        let episodes: EpisodeInfo[];
        let seasons: number[] = [];
        if (listed?.length) {
          if (season !== 1)
            return json({ error: "This catalog uses absolute episode numbers." }, 400);
          episodes = listed
            .filter((e) => Number.isFinite(e.index) && e.index > 0)
            .map((e) => ({
              season: 1,
              episode: e.index,
              name: e.name ?? e.label,
              providerEpisodeIdentity: e.providerEpisodeIdentity,
              externalIds: e.externalIds,
              artwork: e.artwork,
              release: e.release,
            }));
        } else if (entry.mode === "series" && provider?.metadata.catalogIdentity === "tmdb") {
          const data = await fetchSeriesData(
            entry.title.externalIds?.tmdbId ?? entry.title.id,
            season,
          );
          seasons = data.seasons ?? [];
          const selected = seasons.includes(season) ? season : (seasons[0] ?? 1);
          episodes = (data.episodes ?? []).map((e) => ({
            season: selected,
            episode: e.number,
            name: e.name,
            airDate: e.airDate,
          }));
        } else episodes = [];
        work.signal.throwIfAborted();
        if (!run.isAlive("episodes", work.controller))
          return json({ error: "Request cancelled" }, 409);
        if (!episodes.length)
          return json({ error: "Episode catalog unavailable. Try again." }, 502);
        run.catalog.setEpisodes(id, episodes);
        return json({
          ok: true,
          seasons,
          episodes: episodes.map((e) => ({
            number: e.episode,
            title: e.name ?? `Episode ${e.episode}`,
            season: e.season,
          })),
        });
      }
      const episode =
        single && number === 1 && season === 1
          ? { season: 1, episode: 1 }
          : run.catalog.getEpisode(id, season, number);
      if (!episode) return json({ error: "Choose an available episode first." }, 400);
      if (path === "/api/stream") {
        const mediaId = url.searchParams.get("mediaId") ?? "";
        if (!/^[0-9a-f]{32}$/.test(mediaId)) return json({ error: "Invalid media session" }, 400);
        run.startMedia(mediaId);
        const work = run.beginWork("media", request.signal);
        const resolved = await resolve(entry, episode, work.signal);
        work.signal.throwIfAborted();
        if (!run.isAlive("media", work.controller))
          return json({ error: "Request cancelled" }, 409);
        if (!resolved.stream) return json({ ok: false, reason: "No playable stream was found." });
        const session = await gatewayFor(resolved.stream, run, work.signal, origin);
        if (!session)
          return json({
            ok: false,
            browserPlayable: false,
            reason: "This format needs the on-device player. Choose Play on this device.",
          });
        return json({
          ok: true,
          streamUrl: session.mediaUrl,
          subtitleUrls: [...session.subtitleUrls],
          providerId: resolved.providerId,
          browserPlayable: true,
        });
      }
      if (path === "/api/control") {
        if (["starting", "playing"].includes(run.playback.state))
          return json({ error: "Stop the current playback before starting another." }, 409);
        // The HTTP request ends at acceptance; this run-owned signal survives until Stop or shutdown.
        const work = run.beginWork("player");
        const profile = profileFor(container, entry);
        run.playback = { state: "starting", title: entry.title.name };
        void (async () => {
          try {
            const resolved = await resolve(entry, episode, work.signal);
            work.signal.throwIfAborted();
            if (!run.isAlive("player", work.controller)) return;
            if (!resolved.stream) throw new Error("No playable stream");
            const stream = resolved.stream;
            const result = await container.player.play(stream, {
              url: stream.url,
              headers: stream.headers,
              subtitle: stream.subtitle,
              displayTitle: entry.title.name,
              audioPreference: profile.audio,
              subtitlePreference: profile.subtitle,
              qualityPreference: profile.quality,
              abortSignal: work.controller.signal,
              onPlaybackEvent: ({ event }) => {
                if (run.isAlive("player", work.controller) && event.type === "playback-started")
                  run.playback = { state: "playing", title: entry.title.name };
              },
            });
            if (run.isAlive("player", work.controller))
              run.playback = result.handoff?.accepted
                ? { state: "handed-off", title: entry.title.name }
                : result.endReason === "error"
                  ? {
                      state: "failed",
                      title: entry.title.name,
                      error: "The player could not play this stream.",
                    }
                  : { state: "ended", title: entry.title.name };
          } catch {
            if (run.isAlive("player", work.controller))
              run.playback = {
                state: "failed",
                title: entry.title.name,
                error: "Playback failed. Try another source in Kunai.",
              };
          }
        })();
        return json({ ok: true, action: "play", state: "starting" }, 202);
      }
      return json({ error: "Not found" }, 404);
    } catch (error) {
      if (error instanceof RangeError) return json({ error: "Payload too large" }, 413);
      if (error instanceof SyntaxError) return json({ error: "Invalid JSON" }, 400);
      if (error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name))
        return json({ error: "Request cancelled or timed out. Try again." }, 409);
      return json({ error: "Request failed. Try again." }, 502);
    }
  };
}
