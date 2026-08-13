import { openExternalUrl } from "@/infra/shell/open-external-url";
import type { HistoryProgress } from "@kunai/storage";

import type { SyncTokenStore } from "../persistence/SyncTokenStore";
import { resolveAniListAuth, type AniListAuthResolution } from "./auth-contract";
import { createOAuthState, startLoopbackServer, type LoopbackResult } from "./oauth-loopback";
import type { TrackerOperation } from "./operations";
import {
  outcomeForAbortedRequest,
  startRequestDeadline,
  type RequestDeadline,
} from "./request-deadline";
import { resolveAniListIdentity, resolveAniListProgressEpisode } from "./sync-identity";
import type { SyncAdapter, SyncResult } from "./SyncAdapter";
import {
  syncFailed,
  syncNeedsReauth,
  syncOk,
  type SyncCapabilities,
  type SyncMutationOptions,
  type SyncOutcome,
} from "./types";

/**
 * AniList reports application-level problems as a 200 with an `errors` array,
 * so a bare `res.ok` check treats a rejected write as a success. An expired or
 * revoked token surfaces here too and must become a reauth demand rather than a
 * retry, or the queue spins against a credential the server has already refused.
 */
function outcomeForGraphQlErrors(errors?: { message: string }[]): SyncOutcome | null {
  const first = errors?.[0]?.message;
  if (!first) return null;
  if (/invalid token|unauthorized|not authenticated/i.test(first)) {
    return syncNeedsReauth("token-rejected");
  }
  return syncFailed("remote-error", "remote", first.slice(0, 256));
}

function errorCode(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

/**
 * Say what the user must configure, without echoing any value they set. Each
 * reason names one concrete missing or malformed input, because "authorization
 * failed" sends people looking at their AniList account rather than their env.
 */
function aniListAuthMessage(
  reason: Extract<AniListAuthResolution["availability"], { available: false }>["reason"],
): string {
  switch (reason) {
    case "client-id-missing":
      return "Set KUNAI_ANILIST_CLIENT_ID to your AniList application client ID.";
    case "client-id-invalid":
      return "KUNAI_ANILIST_CLIENT_ID is empty or a placeholder.";
    case "callback-missing":
      return "Set KUNAI_ANILIST_REDIRECT_URI to the redirect URI registered on your AniList application.";
    case "callback-not-loopback":
      return "KUNAI_ANILIST_REDIRECT_URI must be a loopback address (127.0.0.1 or localhost).";
    case "callback-invalid":
      return "KUNAI_ANILIST_REDIRECT_URI must look like http://127.0.0.1:43863/callback — http, an explicit port, and the /callback path.";
  }
}

function aniListCallbackMessage(reason: Extract<LoopbackResult, { ok: false }>["reason"]): string {
  switch (reason) {
    case "timeout":
      return "Authorization timed out.";
    case "aborted":
      return "Authorization was cancelled.";
    case "denied":
      return "Authorization was declined in the browser.";
    case "state-mismatch":
      // Refused rather than reported as a transient error: a callback whose
      // state does not match did not come from the request we started.
      return "Authorization could not be verified and was refused.";
  }
}

/**
 * Progress, planning and favourites are the three writes this adapter
 * implements. Pull and rating are deliberately false: no reader or writer for
 * either exists on this branch, and declaring them would put controls in
 * settings that do nothing.
 */
const ANILIST_CAPABILITIES: SyncCapabilities = {
  episodeProgress: true,
  watchlistMembership: true,
  favoriteMembership: true,
  pullLists: false,
  rating: false,
};

const ANILIST_GRAPHQL = "https://graphql.anilist.co";
const OAUTH_BASE = "https://anilist.co/api/v2/oauth";
const OAUTH_TIMEOUT_MS = 90_000;
type AniListFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface ViewerResponse {
  data: { Viewer: { id: number; name: string } };
}

interface MediaListEntryResponse {
  data: { SaveMediaListEntry: { id: number } | null };
  errors?: { message: string }[];
}

interface FavouriteLookupResponse {
  data?: { Media?: { id: number; isFavourite?: boolean } | null };
  errors?: { message: string }[];
}

interface MediaEntryLookupResponse {
  data?: { Media?: { id: number; mediaListEntry?: { id: number } | null } | null };
  errors?: { message: string }[];
}

interface ToggleFavouriteResponse {
  data?: unknown;
  errors?: { message: string }[];
}

interface DeleteEntryResponse {
  data?: { DeleteMediaListEntry?: { deleted: boolean } | null };
  errors?: { message: string }[];
}

export class AniListAdapter implements SyncAdapter {
  readonly id = "anilist" as const;
  readonly displayName = "AniList";
  readonly capabilities = ANILIST_CAPABILITIES;

  private username: string | undefined;
  private userId: number | undefined;
  private accessToken: string | undefined;

  constructor(
    private readonly tokenStore: SyncTokenStore,
    private readonly fetchImpl: AniListFetch = (input, init) => fetch(input, init),
    /**
     * Injected by the container so the adapter never reads `process.env`
     * itself — settings needs the same decision, and two readers drift.
     */
    private readonly auth?: AniListAuthResolution,
  ) {}

  async init(): Promise<void> {
    const tokens = await this.tokenStore.load();
    if (tokens.anilist) {
      this.accessToken = tokens.anilist.accessToken;
      this.userId = tokens.anilist.userId;
    }
  }

  async ensureConnectedUsername(): Promise<void> {
    if (!this.accessToken || this.username) return;
    await this.refreshUsername();
  }

  private async refreshUsername(): Promise<void> {
    if (!this.accessToken) return;
    try {
      const res = await this.gql<ViewerResponse>(`query { Viewer { id name } }`);
      this.username = res.data.Viewer.name;
      this.userId = res.data.Viewer.id;
    } catch {
      this.accessToken = undefined;
    }
  }

  isConnected(): boolean {
    return this.accessToken !== undefined;
  }

  getConnectedUsername(): string | undefined {
    return this.username;
  }

  /**
   * Run the authorization-code flow against the *registered* callback.
   *
   * The redirect URI is configuration, not something Kunai can invent: AniList
   * matches it against the client registration exactly. Both it and the client
   * id must be present and valid before anything is opened or bound, so a
   * misconfiguration is reported here rather than as an opaque token-exchange
   * failure after the user has already approved in a browser.
   */
  async connect(signal: AbortSignal): Promise<SyncResult> {
    const resolution = this.auth ?? resolveAniListAuth();
    const { availability, clientId } = resolution;
    if (!availability.available) {
      return { ok: false, error: aniListAuthMessage(availability.reason) };
    }
    // The resolution type pairs an available result with a non-null client id,
    // but that correlation does not survive destructuring — so this stays as a
    // total guard rather than a non-null assertion.
    if (clientId === null) {
      return { ok: false, error: aniListAuthMessage("client-id-invalid") };
    }

    const state = createOAuthState();
    const callback = startLoopbackServer({
      redirectUri: availability.redirectUri,
      expectedState: state,
      signal,
      timeoutMs: OAUTH_TIMEOUT_MS,
      serviceName: "AniList",
    });

    try {
      const authorizeUrl =
        `${OAUTH_BASE}/authorize?client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(availability.redirectUri)}` +
        `&response_type=code&state=${encodeURIComponent(state)}`;
      void openExternalUrl(authorizeUrl);

      const result = await callback.result;
      if (!result.ok) return { ok: false, error: aniListCallbackMessage(result.reason) };

      const code = result.params.get("code");
      if (!code) return { ok: false, error: "AniList returned no authorization code." };

      const tokenRes = await fetch(`${OAUTH_BASE}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: clientId,
          redirect_uri: availability.redirectUri,
          code,
        }),
        signal,
      });

      if (!tokenRes.ok) {
        return { ok: false, error: `Token exchange failed: ${tokenRes.status}` };
      }
      return await this.persistToken(tokenRes);
    } finally {
      // Frees the registered port on every path, so a retry can bind it.
      callback.close();
    }
  }

  private async persistToken(tokenRes: Response): Promise<SyncResult> {
    const tokenData = (await tokenRes.json()) as { access_token: string; expires_in?: number };
    this.accessToken = tokenData.access_token;
    await this.refreshUsername();

    if (!this.userId) {
      return { ok: false, error: "Could not fetch AniList user info after authorization." };
    }

    await this.tokenStore.patchAniList({
      accessToken: this.accessToken,
      userId: this.userId,
    });

    return { ok: true };
  }

  async disconnect(): Promise<void> {
    this.accessToken = undefined;
    this.username = undefined;
    this.userId = undefined;
    await this.tokenStore.patchAniList(undefined);
  }

  async pushWatched(entry: HistoryProgress): Promise<SyncResult> {
    if (!this.accessToken) return { ok: false, error: "Not connected to AniList." };
    if (!entry.episode) return { ok: true };

    const identity = resolveAniListIdentity(entry);
    if (!identity) return { ok: false, error: `Cannot map title ${entry.titleId} to AniList ID.` };
    const mediaId = identity.anilistId;

    const progress = resolveAniListProgressEpisode(entry);
    if (progress === null) return { ok: true };

    const status = entry.completed && entry.mediaKind === "movie" ? "COMPLETED" : "CURRENT";

    const mutation = `
      mutation SaveProgress($mediaId: Int, $status: MediaListStatus, $progress: Int) {
        SaveMediaListEntry(mediaId: $mediaId, status: $status, progress: $progress) {
          id
        }
      }
    `;

    try {
      const res = await this.gql<MediaListEntryResponse>(mutation, {
        mediaId,
        status,
        progress,
      });
      if (res.errors?.length) {
        return { ok: false, error: res.errors[0]?.message ?? "Unknown AniList error" };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  /**
   * Apply one desired-state operation.
   *
   * Every branch converges on the requested state rather than moving relative
   * to the current one, because the outbox may redeliver a row whose response
   * was lost after AniList already applied it.
   */
  async apply(operation: TrackerOperation, options: SyncMutationOptions): Promise<SyncOutcome> {
    if (operation.target.tracker !== this.id) {
      return syncFailed("tracker-target-mismatch", "mapping");
    }
    if (!this.accessToken) return syncNeedsReauth("not-connected");

    const deadline = startRequestDeadline(options.signal);
    try {
      switch (operation.kind) {
        case "progress:set":
          return await this.setProgress(operation, deadline);
        case "list-membership:set":
          return await this.setWatchlistMembership(operation, deadline);
        case "favorite-membership:set":
          return await this.setFavoriteMembership(operation, deadline);
      }
    } catch (error) {
      return (
        outcomeForAbortedRequest(options.signal, deadline) ??
        syncFailed("request-failed", "network", errorCode(error))
      );
    } finally {
      deadline.release();
    }
  }

  private async setProgress(
    operation: Extract<TrackerOperation, { kind: "progress:set" }>,
    deadline: RequestDeadline,
  ): Promise<SyncOutcome> {
    const res = await this.gql<MediaListEntryResponse>(
      `mutation SaveProgress($mediaId: Int, $status: MediaListStatus, $progress: Int) {
        SaveMediaListEntry(mediaId: $mediaId, status: $status, progress: $progress) { id }
      }`,
      {
        mediaId: operation.target.anilistId,
        status: operation.status === "completed" ? "COMPLETED" : "CURRENT",
        progress: operation.progress,
      },
      deadline,
    );
    return outcomeForGraphQlErrors(res.errors) ?? syncOk();
  }

  /**
   * Kunai's watchlist maps onto AniList's PLANNING status. Removal deletes the
   * list entry, and an already-absent entry is success, not an error — the
   * desired state is what the user asked for and it already holds.
   */
  private async setWatchlistMembership(
    operation: Extract<TrackerOperation, { kind: "list-membership:set" }>,
    deadline: RequestDeadline,
  ): Promise<SyncOutcome> {
    const mediaId = operation.target.tracker === "anilist" ? operation.target.anilistId : 0;
    if (operation.present) {
      const res = await this.gql<MediaListEntryResponse>(
        `mutation SavePlanning($mediaId: Int, $status: MediaListStatus) {
          SaveMediaListEntry(mediaId: $mediaId, status: $status) { id }
        }`,
        { mediaId, status: "PLANNING" },
        deadline,
      );
      return outcomeForGraphQlErrors(res.errors) ?? syncOk();
    }

    const current = await this.gql<MediaEntryLookupResponse>(
      `query EntryFor($mediaId: Int) { Media(id: $mediaId) { id mediaListEntry { id } } }`,
      { mediaId },
      deadline,
    );
    const entryId = current.data?.Media?.mediaListEntry?.id;
    if (entryId === undefined) return syncOk("already-absent");

    const res = await this.gql<DeleteEntryResponse>(
      `mutation RemoveEntry($id: Int) { DeleteMediaListEntry(id: $id) { deleted } }`,
      { id: entryId },
      deadline,
    );
    return outcomeForGraphQlErrors(res.errors) ?? syncOk();
  }

  /**
   * AniList exposes only `ToggleFavourite`, which is a relative operation — so
   * membership is read first and the toggle is sent only when the remote
   * actually differs from the desired state. Toggling blind would undo the
   * user's intent whenever a response was lost in flight.
   */
  private async setFavoriteMembership(
    operation: Extract<TrackerOperation, { kind: "favorite-membership:set" }>,
    deadline: RequestDeadline,
  ): Promise<SyncOutcome> {
    const mediaId = operation.target.tracker === "anilist" ? operation.target.anilistId : 0;
    const current = await this.gql<FavouriteLookupResponse>(
      `query FavouriteFor($mediaId: Int) { Media(id: $mediaId) { id isFavourite } }`,
      { mediaId },
      deadline,
    );
    if (current.data?.Media?.isFavourite === operation.present) {
      return syncOk("already-current");
    }

    const res = await this.gql<ToggleFavouriteResponse>(
      `mutation ToggleFavourite($animeId: Int) {
        ToggleFavourite(animeId: $animeId) { anime { nodes { id } } }
      }`,
      { animeId: mediaId },
      deadline,
    );
    return outcomeForGraphQlErrors(res.errors) ?? syncOk();
  }

  private async gql<T>(
    query: string,
    variables?: Record<string, unknown>,
    deadline?: RequestDeadline,
  ): Promise<T> {
    const res = await this.fetchImpl(ANILIST_GRAPHQL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
      },
      body: JSON.stringify({ query, variables }),
      ...(deadline ? { signal: deadline.signal } : {}),
    });
    if (!res.ok) throw new Error(`AniList API error: ${res.status}`);
    return res.json() as Promise<T>;
  }
}
