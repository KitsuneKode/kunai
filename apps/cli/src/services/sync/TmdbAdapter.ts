import { openExternalUrl } from "@/infra/shell/open-external-url";

import type { SyncTokenStore } from "../persistence/SyncTokenStore";
import type { TrackerOperation } from "./operations";
import { outcomeForAbortedRequest, startRequestDeadline } from "./request-deadline";
import type { SyncAdapter, SyncConnectOptions, SyncResult } from "./SyncAdapter";
import {
  connectedConnection,
  disconnectedConnection,
  syncFailed,
  syncNeedsReauth,
  syncOk,
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

export class TmdbAdapter implements SyncAdapter {
  readonly id = "tmdb" as const;
  readonly displayName = "TMDB";
  readonly capabilities = TMDB_CAPABILITIES;

  private sessionId: string | undefined;
  private accountId: string | undefined;

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
      onPrompt?.(`Approve Kunai at ${authorizeUrl} — then press Enter here.`);
      void openExternalUrl(authorizeUrl);

      await this.waitForEnterOrTimeout(signal);

      const sessionRes = await fetch(
        `${TMDB_API_BASE}/authentication/session/new?api_key=${this.apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ request_token: requestToken }),
          signal,
        },
      );

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

  private async waitForEnterOrTimeout(signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const timeout = setTimeout(settle, TMDB_TIMEOUT_MS);
      signal.addEventListener("abort", () => {
        clearTimeout(timeout);
        settle();
      });
      process.stdin.once("data", () => {
        clearTimeout(timeout);
        settle();
      });
    });
  }
}
