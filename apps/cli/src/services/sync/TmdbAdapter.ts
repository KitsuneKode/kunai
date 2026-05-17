import type { HistoryProgress } from "@kunai/storage";

import type { SyncTokenStore } from "../persistence/SyncTokenStore";
import type { SyncAdapter, SyncResult } from "./SyncAdapter";

const TMDB_API_BASE = "https://api.themoviedb.org/3";
const TMDB_AUTHENTICATE_BASE = "https://www.themoviedb.org/authenticate";
const TMDB_TIMEOUT_MS = 90_000;

export class TmdbAdapter implements SyncAdapter {
  readonly id = "tmdb";
  readonly displayName = "TMDB";

  private sessionId: string | undefined;
  private accountId: string | undefined;

  constructor(
    private readonly tokenStore: SyncTokenStore,
    private readonly apiKey: string,
  ) {}

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

  getConnectedUsername(): string | undefined {
    return this.accountId;
  }

  async connect(signal: AbortSignal): Promise<SyncResult> {
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
      console.log(`\nTMDB authorization URL:\n${authorizeUrl}\n`);
      console.log("After approving, press Enter to continue…");
      this.openUrl(authorizeUrl);

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

  async pushWatched(entry: HistoryProgress): Promise<SyncResult> {
    if (!this.sessionId || !this.accountId) {
      return { ok: false, error: "Not connected to TMDB." };
    }

    const tmdbId = extractTmdbId(entry.titleId);
    if (!tmdbId) {
      return { ok: false, error: `Cannot map title ${entry.titleId} to TMDB ID.` };
    }

    const mediaType = entry.mediaKind === "movie" ? "movie" : "tv";

    try {
      const res = await fetch(
        `${TMDB_API_BASE}/account/${this.accountId}/watchlist?api_key=${this.apiKey}&session_id=${this.sessionId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ media_type: mediaType, media_id: tmdbId, watchlist: false }),
        },
      );
      if (!res.ok) {
        return { ok: false, error: `TMDB watchlist push failed: ${res.status}` };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  private async waitForEnterOrTimeout(signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, TMDB_TIMEOUT_MS);
      signal.addEventListener("abort", () => {
        clearTimeout(timeout);
        resolve();
      });
      process.stdin.once("data", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  private openUrl(url: string): void {
    const openers = ["xdg-open", "open", "start"];
    for (const opener of openers) {
      if (Bun.which(opener)) {
        Bun.spawn([opener, url], { stdout: "ignore", stderr: "ignore" });
        return;
      }
    }
  }
}

function extractTmdbId(titleId: string): number | null {
  const match = /^tmdb:(\d+)$/.exec(titleId);
  if (match) return parseInt(match[1]!, 10);
  return null;
}
