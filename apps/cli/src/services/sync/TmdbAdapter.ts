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

export class TmdbAdapter implements SyncAdapter {
  readonly id = "tmdb" as const;
  readonly displayName = "TMDB";
  readonly capabilities = TMDB_CAPABILITIES;

  private sessionId: string | undefined;
  private accountId: string | undefined;
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
      const res = await this.fetchImpl(`${TMDB_API_BASE}/account/${this.accountId}/${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Credentials travel in headers and body rather than the query
          // string, which is what ends up in proxy and crash logs.
          Authorization: `Bearer ${this.apiKey}`,
          "X-Session-Id": this.sessionId,
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
    }
  }

  isConnected(): boolean {
    return this.sessionId !== undefined;
  }

  getConnection(): ConnectionState {
    if (!this.sessionId) return disconnectedConnection();
    return connectedConnection(this.accountId);
  }

  /**
   * TMDB session ids do not expire and carry no separate identity call worth
   * making on every start: the account id arrives with the session and is
   * stored beside it. Nothing to refresh, so this is honestly empty rather
   * than a request that would only ever confirm what is already known.
   */
  async refreshIdentity(): Promise<void> {}

  /** What the last response said about the budget, for status and diagnostics. */
  getRateLimit() {
    return this.limiter.getSnapshot();
  }

  async connect({ signal, onPrompt }: SyncConnectOptions): Promise<SyncResult> {
    try {
      const tokenRes = await fetch(
        `${TMDB_API_BASE}/authentication/token/new?api_key=${this.apiKey}`,
        { signal },
      );
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

      const accountRes = await fetch(
        `${TMDB_API_BASE}/account?api_key=${this.apiKey}&session_id=${this.sessionId}`,
        { signal },
      );
      if (accountRes.ok) {
        const account = (await accountRes.json()) as { id: number; username?: string };
        this.accountId = account.username ?? String(account.id);
      }

      await this.tokenStore.patchTmdb({
        sessionId: this.sessionId,
        accountId: this.accountId,
      });

      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  async disconnect(): Promise<void> {
    if (this.sessionId) {
      try {
        await fetch(`${TMDB_API_BASE}/authentication/session?api_key=${this.apiKey}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: this.sessionId }),
        });
      } catch {
        // best effort
      }
    }
    this.sessionId = undefined;
    this.accountId = undefined;
    await this.tokenStore.patchTmdb(undefined);
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
      const res = await this.fetchImpl(
        `${TMDB_API_BASE}/authentication/session/new?api_key=${this.apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ request_token: requestToken }),
          signal,
        },
      );
      if (res.ok) return res;
      // 401 means "not approved yet" here, so it is the only status worth
      // waiting on; anything else is a real failure and is returned as-is.
      if (res.status !== 401) return res;
      await Bun.sleep(TMDB_APPROVAL_POLL_MS);
    }
    return null;
  }
}
