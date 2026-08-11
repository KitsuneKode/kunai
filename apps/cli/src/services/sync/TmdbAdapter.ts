import { openExternalUrl } from "@/infra/shell/open-external-url";
import type { MediaKind } from "@kunai/types";

import type { SyncTokenStore } from "../persistence/SyncTokenStore";
import { startLoopbackServer } from "./oauth-loopback";
import { resolveTmdbId, resolveTmdbMediaType } from "./sync-identity";
import type { SyncAdapter } from "./SyncAdapter";
import {
  syncFailed,
  syncOk,
  syncSkipped,
  type ConnectionState,
  type PulledTrackerItem,
  type SyncCapabilities,
  type SyncOutcome,
  type TrackerListItem,
  type TrackerProgress,
} from "./types";

const TMDB_API_BASE = "https://api.themoviedb.org/3";
const TMDB_AUTHENTICATE_BASE = "https://www.themoviedb.org/authenticate";
const TMDB_TIMEOUT_MS = 180_000;

type TmdbFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

class TmdbAuthError extends Error {}
class TmdbRemoteError extends Error {}

interface TmdbListPage {
  readonly page: number;
  readonly total_pages: number;
  readonly results: readonly {
    readonly id: number;
    readonly title?: string;
    readonly name?: string;
  }[];
}

/**
 * TMDB tracker adapter.
 *
 * **TMDB has no episode-progress API.** The v3 account endpoints expose exactly
 * three writable things: watchlist membership, favorite membership, and ratings.
 * There is no "I watched S02E04" call. So `pushProgress` reports `skipped`
 * rather than inventing something — the previous implementation POSTed to the
 * watchlist endpoint with `watchlist: false`, which *removed* the title from the
 * user's watchlist every time an episode finished.
 *
 * What TMDB is genuinely good for is list sync in both directions, which is what
 * this adapter implements.
 */
export class TmdbAdapter implements SyncAdapter {
  readonly id = "tmdb" as const;
  readonly displayName = "TMDB";
  readonly capabilities: SyncCapabilities = {
    episodeProgress: false,
    lists: true,
    pull: true,
    rating: true,
  };

  private sessionId: string | undefined;
  private accountId: number | undefined;
  private username: string | undefined;
  private authFailureReason: string | undefined;

  constructor(
    private readonly tokenStore: SyncTokenStore,
    private readonly apiKey: string,
    private readonly fetchImpl: TmdbFetch = (input, init) => fetch(input, init),
  ) {}

  async init(): Promise<void> {
    const tokens = await this.tokenStore.load();
    if (!tokens.tmdb) return;
    this.sessionId = tokens.tmdb.sessionId;
    this.accountId = tokens.tmdb.accountId;
    this.username = tokens.tmdb.username;
  }

  /** Validate the saved session. Only a 401 clears it; network errors do not. */
  async refreshIdentity(): Promise<void> {
    if (!this.sessionId) return;
    try {
      const account = await this.request<{ id: number; username?: string }>(
        `/account?api_key=${this.apiKey}&session_id=${this.sessionId}`,
      );
      this.accountId = account.id;
      this.username = account.username;
      this.authFailureReason = undefined;
      await this.tokenStore.patchTmdb({
        sessionId: this.sessionId,
        accountId: this.accountId,
        ...(this.username ? { username: this.username } : {}),
      });
    } catch (error) {
      if (error instanceof TmdbAuthError) {
        this.authFailureReason = "TMDB rejected the saved session. Reconnect to continue syncing.";
      }
    }
  }

  getConnection(): ConnectionState {
    if (!this.sessionId) return { state: "disconnected" };
    if (this.authFailureReason) {
      return {
        state: "needs-reauth",
        ...(this.username ? { username: this.username } : {}),
        reason: this.authFailureReason,
      };
    }
    return { state: "connected", ...(this.username ? { username: this.username } : {}) };
  }

  isConnected(): boolean {
    return this.sessionId !== undefined && this.authFailureReason === undefined;
  }

  getConnectedUsername(): string | undefined {
    return this.username;
  }

  /**
   * TMDB v3 request-token flow with a loopback `redirect_to`.
   *
   * The browser redirect is what tells us approval finished. The previous
   * implementation instead blocked on `process.stdin.once("data")`, which
   * fights the Ink shell for stdin and leaves the terminal in a bad state.
   */
  async connect(options: {
    readonly signal: AbortSignal;
    readonly onPrompt: (message: string) => void;
  }): Promise<SyncOutcome> {
    let server: ReturnType<typeof startLoopbackServer> | undefined;
    try {
      const tokenData = await this.request<{ request_token: string; success: boolean }>(
        `/authentication/token/new?api_key=${this.apiKey}`,
        { signal: options.signal },
      );
      if (!tokenData.success) return syncFailed("TMDB did not return a request token.", "remote");

      server = startLoopbackServer({
        signal: options.signal,
        timeoutMs: TMDB_TIMEOUT_MS,
        mode: "query",
        serviceName: "TMDB",
      });

      const authorizeUrl =
        `${TMDB_AUTHENTICATE_BASE}/${tokenData.request_token}` +
        `?redirect_to=${encodeURIComponent(server.redirectUri)}`;

      const opened = await openExternalUrl(authorizeUrl);
      options.onPrompt(
        opened.ok
          ? "Approve Kunai in your browser to finish connecting TMDB."
          : `Open this URL to authorize TMDB: ${authorizeUrl}`,
      );

      const result = await server.result;
      if (!result.ok) {
        return syncFailed(
          result.reason === "timeout"
            ? "Authorization timed out. Run /sync and try again."
            : result.reason === "denied"
              ? "Authorization was declined in the browser."
              : "Authorization was cancelled.",
          "auth",
        );
      }

      const session = await this.request<{ session_id: string; success: boolean }>(
        `/authentication/session/new?api_key=${this.apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ request_token: tokenData.request_token }),
          signal: options.signal,
        },
      );
      if (!session.success) return syncFailed("TMDB session creation was not successful.", "auth");

      this.sessionId = session.session_id;
      this.authFailureReason = undefined;
      await this.refreshIdentity();

      if (this.accountId === undefined) {
        this.sessionId = undefined;
        return syncFailed("Could not read your TMDB account after authorization.", "auth");
      }

      await this.tokenStore.patchTmdb({
        sessionId: this.sessionId,
        accountId: this.accountId,
        ...(this.username ? { username: this.username } : {}),
      });

      return syncOk(`Connected as ${this.username ?? this.accountId}`);
    } catch (error) {
      return this.toOutcome(error);
    } finally {
      server?.close();
    }
  }

  async disconnect(): Promise<void> {
    if (this.sessionId) {
      try {
        await this.fetchImpl(`${TMDB_API_BASE}/authentication/session?api_key=${this.apiKey}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: this.sessionId }),
        });
      } catch {
        // Best effort — dropping the local session is what matters.
      }
    }
    this.sessionId = undefined;
    this.accountId = undefined;
    this.username = undefined;
    this.authFailureReason = undefined;
    await this.tokenStore.patchTmdb(undefined);
  }

  /**
   * TMDB cannot record watch progress. This is a structural limit of the API,
   * not a failure, so it never enters the retry outbox.
   */
  async pushProgress(progress: TrackerProgress): Promise<SyncOutcome> {
    return Promise.resolve(
      syncSkipped(
        progress.mediaKind === "anime"
          ? "TMDB has no episode-progress API — AniList tracks anime progress."
          : "TMDB has no episode-progress API; it syncs watchlist and favourites only.",
      ),
    );
  }

  async pushListItem(item: TrackerListItem): Promise<SyncOutcome> {
    if (!this.sessionId || this.accountId === undefined) {
      return syncFailed("Not connected to TMDB.", "auth");
    }
    if (this.authFailureReason) return syncFailed(this.authFailureReason, "auth");

    const tmdbId = resolveTmdbId(item);
    if (!tmdbId) return syncFailed(`No TMDB id for "${item.title}".`, "mapping");

    const mediaType = resolveTmdbMediaType(item.mediaKind);
    if (!mediaType) return syncSkipped(`TMDB has no catalog entry for ${item.mediaKind}.`);

    const endpoint = item.listKind === "favorites" ? "favorite" : "watchlist";
    // The flag key differs per endpoint, and sending the wrong one silently
    // removes the title — this is exactly what the old code did.
    const flagKey = item.listKind === "favorites" ? "favorite" : "watchlist";

    try {
      await this.request(
        `/account/${this.accountId}/${endpoint}?api_key=${this.apiKey}&session_id=${this.sessionId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ media_type: mediaType, media_id: tmdbId, [flagKey]: true }),
        },
      );
      return syncOk(
        item.listKind === "favorites" ? "Added to TMDB favourites" : "Added to TMDB watchlist",
      );
    } catch (error) {
      return this.toOutcome(error);
    }
  }

  /** Read watchlist + favourites (movies and TV) back into Kunai. */
  async pullList(options: { readonly signal?: AbortSignal } = {}): Promise<PulledTrackerItem[]> {
    if (!this.sessionId || this.accountId === undefined) return [];

    const sources: readonly {
      readonly path: string;
      readonly kind: MediaKind;
    }[] = [
      { path: "watchlist/movies", kind: "movie" },
      { path: "watchlist/tv", kind: "series" },
      { path: "favorite/movies", kind: "movie" },
      { path: "favorite/tv", kind: "series" },
    ];

    const byId = new Map<string, PulledTrackerItem>();
    for (const source of sources) {
      for await (const row of this.paginate(source.path, options.signal)) {
        const externalIds = { tmdbId: String(row.id) };
        const key = `${source.kind}:${row.id}`;
        if (byId.has(key)) continue;
        byId.set(key, {
          remoteId: String(row.id),
          title: row.title ?? row.name ?? `TMDB ${row.id}`,
          mediaKind: source.kind,
          externalIds,
          status: "planning",
        });
      }
    }
    return [...byId.values()];
  }

  private async *paginate(
    path: string,
    signal?: AbortSignal,
  ): AsyncGenerator<TmdbListPage["results"][number]> {
    // TMDB caps account lists at 500 pages; stop well before that so a pull
    // never becomes an unbounded crawl on a huge account.
    const maxPages = 20;
    for (let page = 1; page <= maxPages; page += 1) {
      const data = await this.request<TmdbListPage>(
        `/account/${this.accountId}/${path}?api_key=${this.apiKey}&session_id=${this.sessionId}&page=${page}`,
        signal ? { signal } : {},
      );
      for (const row of data.results ?? []) yield row;
      if (page >= (data.total_pages ?? 1)) return;
    }
  }

  private toOutcome(error: unknown): SyncOutcome {
    if (error instanceof TmdbAuthError) {
      this.authFailureReason = error.message;
      return syncFailed(error.message, "auth");
    }
    if (error instanceof TmdbRemoteError) return syncFailed(error.message, "remote");
    return syncFailed(error instanceof Error ? error.message : String(error), "network");
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchImpl(`${TMDB_API_BASE}${path}`, init);
    if (res.status === 401 || res.status === 403) {
      throw new TmdbAuthError("TMDB rejected the saved session. Reconnect to continue syncing.");
    }
    if (!res.ok) {
      throw new TmdbRemoteError(`TMDB API error ${res.status}`);
    }
    return (await res.json()) as T;
  }
}
