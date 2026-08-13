import { openExternalUrl } from "@/infra/shell/open-external-url";

import type { SyncTokenStore } from "../persistence/SyncTokenStore";
import { resolveAniListAuth, type AniListAuthResolution } from "./auth-contract";
import { startLoopbackServer, type LoopbackResult, type LoopbackServer } from "./oauth-loopback";
import type { TrackerOperation } from "./operations";
import { TrackerRateLimiter } from "./rate-limit";
import {
  outcomeForAbortedRequest,
  startRequestDeadline,
  type RequestDeadline,
} from "./request-deadline";
import type { SyncAdapter, SyncConnectOptions, SyncResult } from "./SyncAdapter";
import {
  connectedConnection,
  disconnectedConnection,
  needsReauthConnection,
  syncFailed,
  syncNeedsReauth,
  syncOk,
  syncRateLimited,
  type ConnectionState,
  type SyncCapabilities,
  type SyncMutationOptions,
  type SyncOutcome,
} from "./types";

/**
 * AniList's GraphQL envelope, classified by what can be done about it.
 *
 * Every application-level problem arrives as an `errors` array — often with a
 * 200 — so a bare `res.ok` check reads a rejected write as a success. The
 * status inside each error is what separates the three fates:
 *
 *  - 400/404 are the request's own fault. Validation failures carry a
 *    `validation` map naming the offending fields. Retrying cannot change the
 *    answer, so these dead-letter instead of cycling until the backoff caps.
 *  - 401/403 mean the credential is dead and must become a reauth demand, or
 *    the queue spins against a token the server has already refused.
 *  - 429 is the rate limit reported inside the envelope rather than as an HTTP
 *    status; without this branch it retries on our schedule, not AniList's.
 *
 * Anything else is treated as transient, which is the safe default: a wrongly
 * retried row costs one request, a wrongly dead-lettered one loses the write.
 */
interface AniListGraphQlError {
  readonly message: string;
  readonly status?: number;
  readonly validation?: Record<string, readonly string[]>;
}

function outcomeForGraphQlErrors(errors?: readonly AniListGraphQlError[]): SyncOutcome | null {
  const first = errors?.[0];
  if (!first?.message) return null;

  if (first.status === 429) return syncRateLimited(DEFAULT_GRAPHQL_RETRY_AFTER_MS, first.message);

  if (first.status === 401 || first.status === 403) return syncNeedsReauth("token-rejected");
  if (/invalid token|unauthorized|not authenticated/i.test(first.message)) {
    return syncNeedsReauth("token-rejected");
  }

  if (first.validation) {
    // Name the field, not the value: the message is stored and displayed.
    const field = Object.keys(first.validation)[0] ?? "unknown";
    return syncFailed("validation-rejected", "invalid", `field: ${field}`);
  }
  if (first.status === 400 || first.status === 404) {
    return syncFailed(`remote-${first.status}`, "invalid", first.message.slice(0, 256));
  }

  return syncFailed("remote-error", "remote", first.message.slice(0, 256));
}

/** Carries the status so callers can tell "refused" from "could not ask". */
class AniListHttpError extends Error {
  constructor(readonly status: number) {
    super(`AniList API error: ${status}`);
    this.name = "AniListHttpError";
  }
}

/** A 429 is not a failure, so it travels as its own type with the wait. */
class AniListRateLimitError extends Error {
  constructor(readonly retryAfterMs: number) {
    super("AniList rate limit reached");
    this.name = "AniListRateLimitError";
  }
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
    case "client-id-invalid":
      return "KUNAI_ANILIST_CLIENT_ID is empty or a placeholder. Unset it to use the built-in application.";
    case "callback-missing":
      return "KUNAI_ANILIST_CLIENT_ID is set, so KUNAI_ANILIST_REDIRECT_URI must be the redirect URI registered on that application.";
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
/** AniList's documented default wait when it does not send one itself. */
const DEFAULT_GRAPHQL_RETRY_AFTER_MS = 60_000;
const OAUTH_BASE = "https://anilist.co/api/v2/oauth";
const OAUTH_TIMEOUT_MS = 90_000;
type AniListFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface ViewerResponse {
  data: { Viewer: { id: number; name: string } };
  errors?: readonly AniListGraphQlError[];
}

interface MediaListEntryResponse {
  data: { SaveMediaListEntry: { id: number } | null };
  errors?: readonly AniListGraphQlError[];
}

interface FavouriteLookupResponse {
  data?: { Media?: { id: number; isFavourite?: boolean } | null };
  errors?: readonly AniListGraphQlError[];
}

interface MediaEntryLookupResponse {
  data?: { Media?: { id: number; mediaListEntry?: { id: number } | null } | null };
  errors?: readonly AniListGraphQlError[];
}

interface ToggleFavouriteResponse {
  data?: unknown;
  errors?: readonly AniListGraphQlError[];
}

interface DeleteEntryResponse {
  data?: { DeleteMediaListEntry?: { deleted: boolean } | null };
  errors?: readonly AniListGraphQlError[];
}

export class AniListAdapter implements SyncAdapter {
  readonly id = "anilist" as const;
  readonly displayName = "AniList";
  readonly capabilities = ANILIST_CAPABILITIES;

  private username: string | undefined;
  private userId: number | undefined;
  private accessToken: string | undefined;
  private expiresAt: string | undefined;
  private readonly limiter = new TrackerRateLimiter();
  /** Set only when AniList has actually refused the token, never on a timeout. */
  private reauthReason: string | undefined;

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
      this.expiresAt = tokens.anilist.expiresAt;
    }
  }

  async refreshIdentity(options?: SyncMutationOptions): Promise<void> {
    if (!this.accessToken) return;
    await this.refreshUsername(options);
  }

  /**
   * Fetch the viewer, and treat only a refusal as a refusal.
   *
   * This used to drop the access token on any thrown error, so a startup with
   * no network silently disconnected the account and the user had to reconnect
   * for a problem that had already gone away. A 401/403 means the credential is
   * dead; anything else means we could not ask.
   */
  private async refreshUsername(options?: SyncMutationOptions): Promise<void> {
    if (!this.accessToken) return;
    const deadline = startRequestDeadline(options?.signal ?? new AbortController().signal);
    try {
      const res = await this.gql<ViewerResponse>(
        `query { Viewer { id name } }`,
        undefined,
        deadline,
      );
      const rejection = outcomeForGraphQlErrors(res.errors);
      if (rejection?.status === "needs-reauth") {
        this.reauthReason = rejection.code;
        return;
      }
      this.username = res.data.Viewer.name;
      this.userId = res.data.Viewer.id;
      this.reauthReason = undefined;
    } catch (error) {
      if (error instanceof AniListHttpError && (error.status === 401 || error.status === 403)) {
        this.reauthReason = "token-rejected";
      }
    } finally {
      deadline.release();
    }
  }

  isConnected(): boolean {
    return this.accessToken !== undefined;
  }

  getConnection(): ConnectionState {
    if (!this.accessToken) return disconnectedConnection();
    if (this.reauthReason) return needsReauthConnection(this.reauthReason, this.username);
    return connectedConnection(this.username, this.expiresAt);
  }

  /**
   * Run the implicit grant against the registered callback.
   *
   * The authorization URL carries `client_id` and `response_type` and nothing
   * else, because that is empirically the only shape AniList accepts: adding
   * `redirect_uri` or `state` makes it answer `unsupported_grant_type`. It uses
   * the callback registered on the application, which is why that URI is fixed
   * configuration rather than something Kunai can choose at runtime.
   *
   * No client secret is involved. The token comes back in the redirect
   * fragment, so there is no token endpoint to authenticate against and Kunai
   * ships no credential that could leak.
   */
  async connect({ signal, onPrompt }: SyncConnectOptions): Promise<SyncResult> {
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

    let callback: LoopbackServer;
    try {
      callback = startLoopbackServer({
        redirectUri: availability.redirectUri,
        // AniList echoes no nonce back on this grant, so there is none to
        // compare. The listener is single-use and torn down either way.
        expectedState: "",
        signal,
        timeoutMs: OAUTH_TIMEOUT_MS,
        serviceName: "AniList",
      });
    } catch {
      // The port is registered on the AniList application, so another one
      // cannot be substituted — a busy port is a real dead end and says so.
      return {
        ok: false,
        error: `Could not listen on ${availability.redirectUri}. Another program is using that port; free it and try again.`,
      };
    }

    try {
      const authorizeUrl =
        `${OAUTH_BASE}/authorize?client_id=${encodeURIComponent(clientId)}` +
        `&response_type=token`;
      onPrompt?.("Approve Kunai in your browser to finish connecting AniList.");
      void openExternalUrl(authorizeUrl);

      const result = await callback.result;
      if (!result.ok) return { ok: false, error: aniListCallbackMessage(result.reason) };

      const accessToken = result.params.get("access_token");
      if (!accessToken) return { ok: false, error: "AniList returned no access token." };

      return await this.persistToken(accessToken, result.params.get("expires_in"));
    } finally {
      // Frees the registered port on every path, so a retry can bind it.
      callback.close();
    }
  }

  private async persistToken(accessToken: string, expiresIn: string | null): Promise<SyncResult> {
    this.accessToken = accessToken;
    // Identity doubles as validation: a token AniList will not answer for is
    // not worth persisting, and `userId` is needed by the token record anyway.
    await this.refreshUsername();

    if (!this.userId) {
      return { ok: false, error: "Could not fetch AniList user info after authorization." };
    }

    const seconds = Number(expiresIn);
    this.expiresAt =
      Number.isFinite(seconds) && seconds > 0
        ? new Date(Date.now() + seconds * 1000).toISOString()
        : undefined;
    this.reauthReason = undefined;
    await this.tokenStore.patchAniList({
      accessToken,
      userId: this.userId,
      ...(this.expiresAt ? { expiresAt: this.expiresAt } : {}),
    });

    return { ok: true };
  }

  async disconnect(): Promise<void> {
    this.accessToken = undefined;
    this.username = undefined;
    this.userId = undefined;
    this.expiresAt = undefined;
    this.reauthReason = undefined;
    await this.tokenStore.patchAniList(undefined);
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
      if (error instanceof AniListRateLimitError) return syncRateLimited(error.retryAfterMs);
      return (
        outcomeForAbortedRequest(options.signal, deadline) ??
        syncFailed("request-failed", "network", errorCode(error))
      );
    } finally {
      deadline.release();
    }
  }

  /** What the last response said about the budget, for status and diagnostics. */
  getRateLimit() {
    return this.limiter.getSnapshot();
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
    /**
     * A failed lookup is not an absent entry.
     *
     * Without this, a rejected read left `entryId` undefined and the removal
     * reported success — so the row was completed, the title stayed on the
     * user's list, and nothing anywhere said so. "I could not check" has to
     * stay distinct from "there is nothing to remove".
     */
    const lookupFailure = outcomeForGraphQlErrors(current.errors);
    if (lookupFailure) return lookupFailure;

    const media = current.data?.Media;
    if (!media) {
      return syncFailed("entry-state-unknown", "remote", "lookup returned no media");
    }

    const entryId = media.mediaListEntry?.id;
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
    /**
     * The read decides whether to toggle, so its failure has to stop the write.
     *
     * `ToggleFavourite` is a flip, not a set — the one relative operation in
     * this adapter. Reaching it without a definite current value turns a
     * redelivery into an unbounded flip-flop, which is precisely what desired
     * state exists to prevent. So an unclassified or empty read refuses rather
     * than guessing.
     */
    const lookupFailure = outcomeForGraphQlErrors(current.errors);
    if (lookupFailure) return lookupFailure;

    const isFavourite = current.data?.Media?.isFavourite;
    if (isFavourite === undefined) {
      return syncFailed("favourite-state-unknown", "remote", "lookup returned no membership");
    }
    if (isFavourite === operation.present) return syncOk("already-current");

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
    // Ease off before asking, not after being refused.
    if (deadline) await this.limiter.waitInline(deadline.signal);

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
    const budget = this.limiter.observe(res);
    if (res.status === 429) {
      throw new AniListRateLimitError(budget.retryAfterMs ?? DEFAULT_GRAPHQL_RETRY_AFTER_MS);
    }
    if (!res.ok) throw new AniListHttpError(res.status);
    return res.json() as Promise<T>;
  }
}
