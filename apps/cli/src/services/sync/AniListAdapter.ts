import type { HistoryProgress } from "@kunai/storage";

import type { SyncTokenStore } from "../persistence/SyncTokenStore";
import type { SyncAdapter, SyncResult } from "./SyncAdapter";

const ANILIST_GRAPHQL = "https://graphql.anilist.co";
const OAUTH_BASE = "https://anilist.co/api/v2/oauth";
const OAUTH_TIMEOUT_MS = 90_000;

interface ViewerResponse {
  data: { Viewer: { id: number; name: string } };
}

interface MediaListEntryResponse {
  data: { SaveMediaListEntry: { id: number } | null };
  errors?: { message: string }[];
}

export class AniListAdapter implements SyncAdapter {
  readonly id = "anilist";
  readonly displayName = "AniList";

  private username: string | undefined;
  private userId: number | undefined;
  private accessToken: string | undefined;

  constructor(private readonly tokenStore: SyncTokenStore) {}

  async init(): Promise<void> {
    const tokens = await this.tokenStore.load();
    if (tokens.anilist) {
      this.accessToken = tokens.anilist.accessToken;
      this.userId = tokens.anilist.userId;
      await this.refreshUsername();
    }
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

  async connect(signal: AbortSignal): Promise<SyncResult> {
    const clientId = process.env.KUNAI_ANILIST_CLIENT_ID;
    if (!clientId) {
      return {
        ok: false,
        error:
          "KUNAI_ANILIST_CLIENT_ID env var is not set. Set it to your AniList application client ID.",
      };
    }

    const port = await this.findFreePort();
    const callbackUrl = `http://localhost:${port}/callback`;
    const authorizeUrl = `${OAUTH_BASE}/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(callbackUrl)}&response_type=code`;

    console.log(`\nAniList authorization URL:\n${authorizeUrl}\n`);
    console.log("Opening in browser… (60s timeout)");
    this.openUrl(authorizeUrl);

    const code = await this.waitForCallback(port, signal);
    if (!code) {
      return { ok: false, error: "Authorization timed out or was cancelled." };
    }

    const tokenRes = await fetch(`${OAUTH_BASE}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: clientId,
        redirect_uri: callbackUrl,
        code,
      }),
      signal,
    });

    if (!tokenRes.ok) {
      return { ok: false, error: `Token exchange failed: ${tokenRes.status}` };
    }

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

    const mediaId = extractAniListId(entry.titleId);
    if (!mediaId) return { ok: false, error: `Cannot map title ${entry.titleId} to AniList ID.` };

    const status = entry.completed && entry.mediaKind === "movie" ? "COMPLETED" : "CURRENT";
    const progress = entry.episode ?? 0;

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
        return { ok: false, error: res.errors[0]!.message };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  private async gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const res = await fetch(ANILIST_GRAPHQL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`AniList API error: ${res.status}`);
    return res.json() as Promise<T>;
  }

  private async findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const net = require("node:net") as typeof import("node:net");
      const srv = net.createServer();
      srv.listen(0, "127.0.0.1", () => {
        const addr = srv.address();
        srv.close(() => {
          if (addr && typeof addr === "object") resolve(addr.port);
          else reject(new Error("Could not find free port"));
        });
      });
    });
  }

  private async waitForCallback(port: number, signal: AbortSignal): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          server.stop(true);
          resolve(null);
        }
      }, OAUTH_TIMEOUT_MS);

      signal.addEventListener("abort", () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          server.stop(true);
          resolve(null);
        }
      });

      const server = Bun.serve({
        port,
        hostname: "127.0.0.1",
        fetch(req) {
          if (resolved) return new Response("Already handled", { status: 409 });
          const url = new URL(req.url);
          const code = url.searchParams.get("code");
          if (url.pathname === "/callback" && code) {
            resolved = true;
            clearTimeout(timeout);
            resolve(code);
            server.stop(true);
            return new Response(
              "<html><body><h2>Authorization complete. You can close this tab.</h2></body></html>",
              { headers: { "Content-Type": "text/html" } },
            );
          }
          return new Response("Waiting for authorization…");
        },
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

function extractAniListId(titleId: string): number | null {
  const match = /^anilist:(\d+)$/.exec(titleId) ?? /^mal:(\d+)$/.exec(titleId);
  if (match) return parseInt(match[1]!, 10);
  const tmdbMatch = /^tmdb:(\d+)$/.exec(titleId);
  if (tmdbMatch) return parseInt(tmdbMatch[1]!, 10);
  return null;
}
