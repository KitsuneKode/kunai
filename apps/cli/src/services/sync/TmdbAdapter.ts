import { withTimeoutSignal } from "@/infra/abort/timeout-signal";
import { openExternalUrl } from "@/infra/shell/open-external-url";

import type { SyncTokenStore } from "../persistence/SyncTokenStore";
import type { TrackerOperation } from "./operations";
import { TrackerRateLimiter } from "./rate-limit";
import { outcomeForAbortedRequest, startRequestDeadline } from "./request-deadline";
import type { SyncAdapter, SyncConnectOptions, SyncResult } from "./SyncAdapter";
import {
  connectedConnection,
  disconnectedConnection,
  syncFailed,
  syncNeedsReauth,
  syncOk,
  syncRateLimited,
  type ConnectionState,
  type SyncCapabilities,
  type SyncMutationOptions,
  type SyncOutcome,
} from "./types";

type TmdbFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * TMDB v3 exposes account watchlist and favourite membership, and nothing that
 * records how far through a series you are — so `episodeProgress` is false and
 * no progress operation may be routed here. Pull and rating are unimplemented
 * on this branch.
 */
const TMDB_CAPABILITIES: SyncCapabilities = {
  episodeProgress: false,
  watchlistMembership: true,
  favoriteMembership: true,
  pullLists: false,
  rating: false,
};

const TMDB_API_BASE = "https://api.themoviedb.org/3";
const TMDB_AUTHENTICATE_BASE = "https://www.themoviedb.org/authenticate";
const TMDB_TIMEOUT_MS = 90_000;
const TMDB_APPROVAL_POLL_MS = 2_000;
/** Per-request ceiling, matching the catalogue path's own TMDB budget. */
const TMDB_REQUEST_TIMEOUT_MS = 8_000;

/**
 * Account linking must talk to `api.themoviedb.org` directly.
 *
 * Catalogue reads go through a third-party TMDB mirror first and fall back to
 * direct (`fetchTmdbJsonWithFallback`), which is why metadata can work on a
 * network where this does not. Authentication may not take that route: a
 * request token and session id are account credentials, and handing them to
 * someone else's server to relay would give that server control of the user's
 * TMDB account. So a network that cannot reach TMDB directly cannot link a
 * TMDB account, and the honest thing is to say exactly that instead of hanging.
 */
const UNREACHABLE_ERROR =
  "Could not reach api.themoviedb.org. Account linking must connect to TMDB " +
  "directly — unlike artwork and metadata, which can fall back to a mirror — so " +
  "a blocked or filtered connection stops it here. Check a proxy, VPN, or DNS " +
  "filter and try again.";

export class TmdbAdapter implements SyncAdapter {
  readonly id = "tmdb" as const;
  readonly displayName = "TMDB";
  readonly capabilities = TMDB_CAPABILITIES;

  /** The numeric v3 account id — what `/account/{account_id}/…` addresses. */
  private accountId: string | undefined;
  /** Display only. Storing this *as* the account id is what broke every write. */
  private username: string | undefined;
  private sessionId: string | undefined;
  private readonly limiter = new TrackerRateLimiter();

  constructor(
    private readonly tokenStore: SyncTokenStore,
    private readonly apiKey: string,
    private readonly fetchImpl: TmdbFetch = (input, init) => fetch(input, init),
  ) {}

  /**
   * Apply one desired-state operation.
   *
   * Both supported writes carry the requested boolean directly, so a redelivery
   * after a lost response converges rather than inverting — which is why the
   * operation records the state and not a toggle.
   */
  async apply(operation: TrackerOperation, options: SyncMutationOptions): Promise<SyncOutcome> {
    if (operation.kind === "progress:set") {
      // Declared as episodeProgress: false. Reaching here means the payload was
      // misrouted, and no retry can make TMDB accept it.
      return syncFailed("capability-unsupported", "invalid");
    }
    if (operation.target.tracker !== this.id) {
      return syncFailed("tracker-target-mismatch", "mapping");
    }
    if (!this.sessionId || !this.accountId) return syncNeedsReauth("not-connected");

    const { mediaKind, tmdbId } = operation.target;
    const [path, field] =
      operation.kind === "list-membership:set"
        ? (["watchlist", "watchlist"] as const)
        : (["favorite", "favorite"] as const);

    const deadline = startRequestDeadline(options.signal);
    try {
      await this.limiter.waitInline(deadline.signal);
      const res = await this.fetchImpl(this.accountUrl(path), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          media_type: mediaKind === "movie" ? "movie" : "tv",
          media_id: tmdbId,
          [field]: operation.present,
        }),
        signal: deadline.signal,
      });

      const budget = this.limiter.observe(res);
      if (res.status === 429) return syncRateLimited(budget.retryAfterMs ?? 60_000);
      if (res.status === 401 || res.status === 403) return syncNeedsReauth("session-rejected");
      if (!res.ok) return syncFailed(`remote-${res.status}`, "remote");
      return syncOk();
    } catch (error) {
      return (
        outcomeForAbortedRequest(options.signal, deadline) ??
        syncFailed("request-failed", "network", error instanceof Error ? error.name : "unknown")
      );
    } finally {
      deadline.release();
    }
  }

  async init(): Promise<void> {
    const tokens = await this.tokenStore.load();
    if (tokens.tmdb) {
      this.sessionId = tokens.tmdb.sessionId;
      this.accountId = tokens.tmdb.accountId;
      this.username = tokens.tmdb.username;
    }
  }

  isConnected(): boolean {
    return this.sessionId !== undefined;
  }

  getConnection(): ConnectionState {
    if (!this.sessionId) return disconnectedConnection();
    return connectedConnection(this.username ?? this.accountId);
  }

  /**
   * TMDB session ids do not expire, so this exists for one job: repair a stored
   * identity that predates the split between account id and username.
   *
   * Earlier builds wrote the username into `accountId`, which is not what
   * `/account/{account_id}/…` accepts — every watchlist and favourite write
   * 404'd or 401'd. Re-resolving here means an already-connected account is
   * fixed on next start instead of needing the user to reconnect.
   */
  async refreshIdentity(options?: SyncMutationOptions): Promise<void> {
    if (!this.sessionId) return;
    if (this.accountId !== undefined && /^\d+$/.test(this.accountId)) return;
    const identity = await this.fetchAccountIdentity(this.sessionId, options?.signal);
    if (!identity) return;
    this.accountId = identity.accountId;
    this.username = identity.username;
    await this.tokenStore.patchTmdb({
      sessionId: this.sessionId,
      accountId: identity.accountId,
      ...(identity.username ? { username: identity.username } : {}),
    });
  }

  /** What the last response said about the budget, for status and diagnostics. */
  getRateLimit() {
    return this.limiter.getSnapshot();
  }

  async connect({ signal, onPrompt }: SyncConnectOptions): Promise<SyncResult> {
    try {
      let tokenRes: Response;
      try {
        tokenRes = await this.fetchImpl(
          `${TMDB_API_BASE}/authentication/token/new?api_key=${this.apiKey}`,
          { signal: withTimeoutSignal(signal, TMDB_REQUEST_TIMEOUT_MS) },
        );
      } catch {
        // Reached before the browser opens, deliberately: opening a tab for a
        // flow that cannot complete is worse than saying why up front.
        return { ok: false, error: UNREACHABLE_ERROR };
      }
      if (!tokenRes.ok) {
        return { ok: false, error: `TMDB token request failed: ${tokenRes.status}` };
      }
      const tokenData = (await tokenRes.json()) as { request_token: string; success: boolean };
      if (!tokenData.success) {
        return { ok: false, error: "TMDB did not return a request token." };
      }

      const requestToken = tokenData.request_token;
      const authorizeUrl = `${TMDB_AUTHENTICATE_BASE}/${requestToken}`;
      onPrompt?.("Approve Kunai in the browser tab that just opened; waiting…");
      void openExternalUrl(authorizeUrl);

      /**
       * Poll for approval instead of waiting on a keypress.
       *
       * This used to read `process.stdin` directly, which cannot work inside
       * the shell: Ink owns stdin in raw mode, so the listener never fired and
       * TMDB Connect simply hung until it timed out and then failed. TMDB has
       * no callback for a device-style flow, but session creation itself is the
       * signal — it refuses until the request token is approved.
       */
      const sessionRes = await this.awaitApprovedSession(requestToken, signal);
      if (!sessionRes) {
        return {
          ok: false,
          error: "Timed out waiting for TMDB approval. Approve in the browser, then try again.",
        };
      }

      if (!sessionRes.ok) {
        return {
          ok: false,
          error: `TMDB session creation failed: ${sessionRes.status}. Did you approve the authorization?`,
        };
      }

      const sessionData = (await sessionRes.json()) as { session_id: string; success: boolean };
      if (!sessionData.success) {
        return { ok: false, error: "TMDB session creation was not successful." };
      }

      this.sessionId = sessionData.session_id;

      // The numeric id is required, not decorative: without it there is no
      // account path to write to, so a connect that cannot resolve one is a
      // failed connect rather than a half-usable link.
      const identity = await this.fetchAccountIdentity(this.sessionId, signal);
      if (!identity) {
        this.sessionId = undefined;
        return { ok: false, error: "TMDB approved the session but returned no account id." };
      }
      this.accountId = identity.accountId;
      this.username = identity.username;

      await this.tokenStore.patchTmdb({
        sessionId: this.sessionId,
        accountId: identity.accountId,
        ...(identity.username ? { username: identity.username } : {}),
      });

      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  async disconnect(options?: SyncMutationOptions): Promise<void> {
    if (this.sessionId) {
      const deadline = startRequestDeadline(options?.signal ?? new AbortController().signal);
      try {
        await this.fetchImpl(`${TMDB_API_BASE}/authentication/session?api_key=${this.apiKey}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: this.sessionId }),
          signal: deadline.signal,
        });
      } catch {
        // best effort
      } finally {
        deadline.release();
      }
    }
    this.sessionId = undefined;
    this.accountId = undefined;
    this.username = undefined;
    await this.tokenStore.patchTmdb(undefined);
  }

  /**
   * Build an authenticated v3 account URL.
   *
   * TMDB v3 authenticates account writes with `api_key` and `session_id` in the
   * query string. This previously sent `Authorization: Bearer <v3 key>` and an
   * invented `X-Session-Id` header — neither is part of the API (bearer auth is
   * v4 and takes a read access token, not the 32-character v3 key), so every
   * write was rejected as unauthenticated and reported as "reconnect TMDB".
   *
   * Credentials in a URL are a real hazard, which is what the header shape was
   * reaching for; the mitigation is that this adapter never logs a URL, and
   * `redactSensitive` covers `api_key`/`session_id` for anything that does.
   */
  private accountUrl(path: "watchlist" | "favorite"): string {
    const url = new URL(`${TMDB_API_BASE}/account/${this.accountId}/${path}`);
    url.searchParams.set("api_key", this.apiKey);
    url.searchParams.set("session_id", this.sessionId ?? "");
    return url.toString();
  }

  /** Resolve `{ accountId, username }` for a session, or null if TMDB refuses. */
  private async fetchAccountIdentity(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<{ accountId: string; username?: string } | null> {
    const url = new URL(`${TMDB_API_BASE}/account`);
    url.searchParams.set("api_key", this.apiKey);
    url.searchParams.set("session_id", sessionId);
    const res = await this.fetchImpl(url.toString(), {
      signal: withTimeoutSignal(signal, TMDB_REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const account = (await res.json()) as { id?: number; username?: string };
    if (typeof account.id !== "number" || !Number.isInteger(account.id)) return null;
    return {
      accountId: String(account.id),
      ...(account.username ? { username: account.username } : {}),
    };
  }

  /**
   * Ask for a session until TMDB stops refusing, or the deadline passes.
   *
   * A pending request token yields 401; an approved one yields the session. So
   * the poll is the approval check, and no terminal input is involved — which
   * is what makes this work from inside the Ink shell.
   */
  private async awaitApprovedSession(
    requestToken: string,
    signal: AbortSignal,
  ): Promise<Response | null> {
    const deadline = Date.now() + TMDB_TIMEOUT_MS;
    while (Date.now() < deadline && !signal.aborted) {
      let res: Response;
      try {
        res = await this.fetchImpl(
          `${TMDB_API_BASE}/authentication/session/new?api_key=${this.apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ request_token: requestToken }),
            signal: withTimeoutSignal(signal, TMDB_REQUEST_TIMEOUT_MS),
          },
        );
      } catch {
        // A dropped poll is not a failed approval — the user may still be on
        // the consent page. Keep polling until the outer deadline, so a flaky
        // connection does not abandon a link the user is in the middle of.
        if (signal.aborted) return null;
        await Bun.sleep(TMDB_APPROVAL_POLL_MS);
        continue;
      }
      if (res.ok) return res;
      // 401 means "not approved yet" here, so it is the only status worth
      // waiting on; anything else is a real failure and is returned as-is.
      if (res.status !== 401) return res;
      await Bun.sleep(TMDB_APPROVAL_POLL_MS);
    }
    return null;
  }
}
