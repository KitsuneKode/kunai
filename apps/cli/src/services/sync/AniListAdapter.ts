import { openExternalUrl } from "@/infra/shell/open-external-url";

import type { SyncTokenStore } from "../persistence/SyncTokenStore";
import { startLoopbackServer } from "./oauth-loopback";
import { resolveAniListMediaId, resolveTrackerEpisode } from "./sync-identity";
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
  type TrackerStatus,
} from "./types";

const ANILIST_GRAPHQL = "https://graphql.anilist.co";
const OAUTH_AUTHORIZE = "https://anilist.co/api/v2/oauth/authorize";
const OAUTH_TIMEOUT_MS = 180_000;

/**
 * AniList application id for the OAuth implicit grant.
 *
 * AniList client ids are public by design — the implicit grant carries no
 * secret, and the redirect target is a loopback address on the user's own
 * machine — so this can safely be a compiled-in constant.
 *
 * It is intentionally empty here: Kunai's own application id must be pasted in
 * by a maintainer who actually registered it at
 * https://anilist.co/settings/developer (redirect URI must permit
 * `http://localhost` loopback callbacks). Do not guess a number — an arbitrary
 * id belongs to somebody else's application and would send users through a
 * stranger's OAuth consent screen. Until it is filled in, `connect()` fails with
 * an actionable message and users can supply their own via the env var.
 */
const KUNAI_ANILIST_CLIENT_ID = "";

const DEFAULT_CLIENT_ID = process.env.KUNAI_ANILIST_CLIENT_ID ?? KUNAI_ANILIST_CLIENT_ID;

type AniListFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface GraphQLResponse<T> {
  readonly data?: T;
  readonly errors?: readonly { readonly message: string; readonly status?: number }[];
}

interface ViewerData {
  readonly Viewer: { readonly id: number; readonly name: string } | null;
}

interface MediaEntryData {
  readonly Media: {
    readonly id: number;
    readonly episodes: number | null;
    readonly format: string | null;
    readonly mediaListEntry: {
      readonly id: number;
      readonly status: string | null;
      readonly progress: number | null;
      readonly repeat: number | null;
    } | null;
  } | null;
}

interface SaveEntryData {
  readonly SaveMediaListEntry: { readonly id: number } | null;
}

interface MediaListCollectionData {
  readonly MediaListCollection: {
    readonly lists: readonly {
      readonly entries: readonly {
        readonly id: number;
        readonly status: string | null;
        readonly progress: number | null;
        readonly score: number | null;
        readonly updatedAt: number | null;
        readonly media: {
          readonly id: number;
          readonly idMal: number | null;
          readonly episodes: number | null;
          readonly format: string | null;
          readonly title: {
            readonly userPreferred: string | null;
            readonly romaji: string | null;
            readonly english: string | null;
          } | null;
        } | null;
      }[];
    }[];
  } | null;
}

/** AniList errors that mean "the token is no good" rather than "try again". */
function isAuthFailure(status: number, message?: string): boolean {
  if (status === 400 || status === 401) return true;
  return (message ?? "").toLowerCase().includes("invalid token");
}

class AniListAuthError extends Error {}
class AniListRemoteError extends Error {}

function trackerStatusFromAniList(status: string | null | undefined): TrackerStatus {
  switch (status) {
    case "PLANNING":
      return "planning";
    case "COMPLETED":
      return "completed";
    case "PAUSED":
      return "paused";
    case "DROPPED":
      return "dropped";
    case "REPEATING":
      return "repeating";
    default:
      return "watching";
  }
}

export class AniListAdapter implements SyncAdapter {
  readonly id = "anilist" as const;
  readonly displayName = "AniList";
  readonly capabilities: SyncCapabilities = {
    episodeProgress: true,
    lists: true,
    pull: true,
    rating: true,
  };

  private accessToken: string | undefined;
  private userId: number | undefined;
  private username: string | undefined;
  private expiresAt: string | undefined;
  private authFailureReason: string | undefined;

  constructor(
    private readonly tokenStore: SyncTokenStore,
    private readonly fetchImpl: AniListFetch = (input, init) => fetch(input, init),
    private readonly clientId: string = DEFAULT_CLIENT_ID,
  ) {}

  async init(): Promise<void> {
    const tokens = await this.tokenStore.load();
    if (!tokens.anilist) return;
    this.accessToken = tokens.anilist.accessToken;
    this.userId = tokens.anilist.userId;
    this.username = tokens.anilist.username;
    this.expiresAt = tokens.anilist.expiresAt;

    // Implicit-grant tokens last a year; flag expiry locally instead of waiting
    // for the first push of the day to fail.
    if (this.expiresAt && Date.parse(this.expiresAt) <= Date.now()) {
      this.authFailureReason = "Token expired. Reconnect AniList.";
    }
  }

  /**
   * Confirm the token still works and cache the account name.
   *
   * Only an auth failure clears credentials. A network blip must not log the
   * user out — the previous implementation dropped the token on any thrown
   * error, so an offline launch silently disconnected the account.
   */
  async refreshIdentity(): Promise<void> {
    if (!this.accessToken) return;
    try {
      const data = await this.gql<ViewerData>(`query { Viewer { id name } }`);
      const viewer = data.Viewer;
      if (!viewer) throw new AniListAuthError("AniList returned no viewer for this token.");
      this.username = viewer.name;
      this.userId = viewer.id;
      this.authFailureReason = undefined;
      await this.tokenStore.patchAniList({
        accessToken: this.accessToken,
        userId: this.userId,
        username: this.username,
        ...(this.expiresAt ? { expiresAt: this.expiresAt } : {}),
      });
    } catch (error) {
      if (error instanceof AniListAuthError) {
        this.authFailureReason = "AniList rejected the saved token. Reconnect to continue syncing.";
        return;
      }
      // Transient — keep the credentials and try again next launch.
    }
  }

  getConnection(): ConnectionState {
    if (!this.accessToken) return { state: "disconnected" };
    if (this.authFailureReason) {
      return {
        state: "needs-reauth",
        ...(this.username ? { username: this.username } : {}),
        reason: this.authFailureReason,
      };
    }
    return {
      state: "connected",
      ...(this.username ? { username: this.username } : {}),
      ...(this.expiresAt ? { expiresAt: this.expiresAt } : {}),
    };
  }

  isConnected(): boolean {
    return this.accessToken !== undefined && this.authFailureReason === undefined;
  }

  getConnectedUsername(): string | undefined {
    return this.username;
  }

  /**
   * Implicit-grant OAuth against a loopback redirect.
   *
   * AniList's authorization-code grant requires `client_secret`, which a
   * publicly distributed CLI cannot hold. `response_type=token` returns the
   * access token in the URL fragment instead, which the loopback bridge page
   * posts back to us. Tokens issued this way are valid for one year.
   */
  async connect(options: {
    readonly signal: AbortSignal;
    readonly onPrompt: (message: string) => void;
  }): Promise<SyncOutcome> {
    if (!this.clientId) {
      return syncFailed(
        "No AniList application id is configured. Register an app at " +
          "https://anilist.co/settings/developer with a http://localhost redirect URI, " +
          "then set KUNAI_ANILIST_CLIENT_ID to its client id.",
        "auth",
      );
    }

    const server = startLoopbackServer({
      signal: options.signal,
      timeoutMs: OAUTH_TIMEOUT_MS,
      mode: "fragment",
      serviceName: "AniList",
    });

    const authorizeUrl =
      `${OAUTH_AUTHORIZE}?client_id=${encodeURIComponent(this.clientId)}` +
      `&redirect_uri=${encodeURIComponent(server.redirectUri)}&response_type=token`;

    const opened = await openExternalUrl(authorizeUrl);
    options.onPrompt(
      opened.ok
        ? "Approve Kunai in your browser to finish connecting AniList."
        : `Open this URL to authorize AniList: ${authorizeUrl}`,
    );

    const result = await server.result;
    if (!result.ok) {
      if (result.reason === "denied") {
        return syncFailed("Authorization was declined in the browser.", "auth");
      }
      return syncFailed(
        result.reason === "timeout"
          ? "Authorization timed out. Run /sync and try again."
          : "Authorization was cancelled.",
        "auth",
      );
    }

    const accessToken = result.params.get("access_token");
    if (!accessToken) {
      return syncFailed("AniList did not return an access token.", "auth");
    }

    const expiresInSeconds = Number.parseInt(result.params.get("expires_in") ?? "", 10);
    this.accessToken = accessToken;
    this.expiresAt = Number.isFinite(expiresInSeconds)
      ? new Date(Date.now() + expiresInSeconds * 1000).toISOString()
      : undefined;
    this.authFailureReason = undefined;

    await this.refreshIdentity();
    if (!this.userId) {
      this.accessToken = undefined;
      return syncFailed("Could not read your AniList account after authorization.", "auth");
    }

    await this.tokenStore.patchAniList({
      accessToken,
      userId: this.userId,
      ...(this.username ? { username: this.username } : {}),
      ...(this.expiresAt ? { expiresAt: this.expiresAt } : {}),
    });

    return syncOk(`Connected as @${this.username ?? this.userId}`);
  }

  async disconnect(): Promise<void> {
    this.accessToken = undefined;
    this.userId = undefined;
    this.username = undefined;
    this.expiresAt = undefined;
    this.authFailureReason = undefined;
    await this.tokenStore.patchAniList(undefined);
  }

  /**
   * Push watch progress, reconciling against the remote entry first.
   *
   * Two rules make this safe to run automatically after every episode:
   *
   *  - **Progress never goes backwards.** Watching episode 3 of a show already
   *    marked at 12 must not rewrite the list to 3. Someone re-watching a
   *    finished series would otherwise wipe their completion record.
   *  - **Completion is derived from the episode count**, not from the local
   *    media kind. The old code only ever set COMPLETED for movies, and even
   *    that branch was unreachable, so no series was ever marked finished.
   */
  async pushProgress(progress: TrackerProgress): Promise<SyncOutcome> {
    if (!this.accessToken) return syncFailed("Not connected to AniList.", "auth");
    if (this.authFailureReason) return syncFailed(this.authFailureReason, "auth");
    if (progress.mediaKind === "video") {
      return syncSkipped("AniList does not track standalone videos.");
    }

    const mediaId = resolveAniListMediaId(progress);
    if (!mediaId) {
      return syncFailed(
        `No AniList id for "${progress.title}" — nothing to sync against.`,
        "mapping",
      );
    }

    const episode = resolveTrackerEpisode(progress);
    if (episode === undefined) {
      return syncSkipped("No episode number to report.");
    }

    try {
      const media = await this.fetchMediaEntry(mediaId);
      if (!media) {
        return syncFailed(`AniList has no media with id ${mediaId}.`, "mapping");
      }

      const remoteProgress = media.mediaListEntry?.progress ?? 0;
      const remoteStatus = media.mediaListEntry?.status ?? null;
      const totalEpisodes = media.episodes ?? undefined;
      const isMovie = media.format === "MOVIE" || progress.mediaKind === "movie";

      // Only count an episode once it is actually finished; a partial watch
      // still bumps status to CURRENT so the show leaves "planning".
      const watchedThrough = progress.completed ? episode : Math.max(episode - 1, 0);
      const nextProgress = Math.max(remoteProgress, watchedThrough);

      // A completed entry is never rewritten by an automatic scrobble. AniList
      // models a rewatch by resetting progress to 0 and setting REPEATING, which
      // destroys the completion record if the rewatch is abandoned halfway. That
      // trade is the user's to make, not something to infer from playback, so
      // starting a rewatch stays an explicit action.
      if (remoteStatus === "COMPLETED" && nextProgress <= remoteProgress) {
        return syncSkipped(
          "Already completed on AniList; rewatches are not tracked automatically.",
        );
      }

      const finished =
        (isMovie && progress.completed) ||
        (totalEpisodes !== undefined && totalEpisodes > 0 && nextProgress >= totalEpisodes);

      const status = finished ? "COMPLETED" : "CURRENT";

      if (
        remoteStatus === status &&
        nextProgress === remoteProgress &&
        media.mediaListEntry !== null
      ) {
        return syncSkipped("AniList already up to date.");
      }

      const saved = await this.gql<SaveEntryData>(
        `
          mutation SaveProgress($mediaId: Int, $status: MediaListStatus, $progress: Int) {
            SaveMediaListEntry(mediaId: $mediaId, status: $status, progress: $progress) { id }
          }
        `,
        { mediaId, status, progress: nextProgress },
      );

      if (!saved.SaveMediaListEntry) {
        return syncFailed("AniList did not save the list entry.", "remote");
      }

      return syncOk(
        finished
          ? `Marked complete on AniList`
          : `AniList progress → ${nextProgress}${totalEpisodes ? `/${totalEpisodes}` : ""}`,
      );
    } catch (error) {
      return this.toOutcome(error);
    }
  }

  /** Mirror a Kunai watchlist add as AniList PLANNING (favorites → FAVOURITE). */
  async pushListItem(item: TrackerListItem): Promise<SyncOutcome> {
    if (!this.accessToken) return syncFailed("Not connected to AniList.", "auth");
    if (this.authFailureReason) return syncFailed(this.authFailureReason, "auth");

    const mediaId = resolveAniListMediaId(item);
    if (!mediaId) {
      return syncFailed(`No AniList id for "${item.title}".`, "mapping");
    }

    try {
      if (item.listKind === "favorites") {
        await this.gql(
          `mutation Favourite($animeId: Int) { ToggleFavourite(animeId: $animeId) { anime { pageInfo { total } } } }`,
          { animeId: mediaId },
        );
        return syncOk("Toggled AniList favourite");
      }

      const media = await this.fetchMediaEntry(mediaId);
      // Never demote an entry that is already being watched or finished.
      if (media?.mediaListEntry?.status && media.mediaListEntry.status !== "PLANNING") {
        return syncSkipped("Already on your AniList list with a stronger status.");
      }

      await this.gql<SaveEntryData>(
        `mutation Plan($mediaId: Int) {
           SaveMediaListEntry(mediaId: $mediaId, status: PLANNING) { id }
         }`,
        { mediaId },
      );
      return syncOk("Added to AniList planning");
    } catch (error) {
      return this.toOutcome(error);
    }
  }

  /** Read the viewer's anime list so Kunai can reconcile local state against it. */
  async pullList(options: { readonly signal?: AbortSignal } = {}): Promise<PulledTrackerItem[]> {
    if (!this.accessToken || !this.userId) return [];

    const data = await this.gql<MediaListCollectionData>(
      `
        query List($userId: Int) {
          MediaListCollection(userId: $userId, type: ANIME) {
            lists {
              entries {
                id status progress score(format: POINT_100) updatedAt
                media { id idMal episodes format title { userPreferred romaji english } }
              }
            }
          }
        }
      `,
      { userId: this.userId },
      options.signal,
    );

    const items: PulledTrackerItem[] = [];
    for (const list of data.MediaListCollection?.lists ?? []) {
      for (const entry of list.entries) {
        const media = entry.media;
        if (!media) continue;
        const title =
          media.title?.userPreferred ??
          media.title?.english ??
          media.title?.romaji ??
          `AniList ${media.id}`;
        items.push({
          remoteId: String(entry.id),
          title,
          mediaKind: "anime",
          externalIds: {
            anilistId: String(media.id),
            ...(media.idMal ? { malId: String(media.idMal) } : {}),
          },
          status: trackerStatusFromAniList(entry.status),
          ...(entry.progress !== null && entry.progress !== undefined
            ? { progress: entry.progress }
            : {}),
          ...(media.episodes ? { totalEpisodes: media.episodes } : {}),
          ...(entry.score ? { score: entry.score } : {}),
          ...(entry.updatedAt ? { updatedAt: new Date(entry.updatedAt * 1000).toISOString() } : {}),
        });
      }
    }
    return items;
  }

  private async fetchMediaEntry(mediaId: number): Promise<MediaEntryData["Media"]> {
    const data = await this.gql<MediaEntryData>(
      `
        query Entry($mediaId: Int) {
          Media(id: $mediaId, type: ANIME) {
            id episodes format
            mediaListEntry { id status progress repeat }
          }
        }
      `,
      { mediaId },
    );
    return data.Media;
  }

  /** Map a thrown adapter error onto the typed outcome the outbox retries on. */
  private toOutcome(error: unknown): SyncOutcome {
    if (error instanceof AniListAuthError) {
      this.authFailureReason = error.message;
      return syncFailed(error.message, "auth");
    }
    if (error instanceof AniListRemoteError) {
      return syncFailed(error.message, "remote");
    }
    return syncFailed(error instanceof Error ? error.message : String(error), "network");
  }

  private async gql<T>(
    query: string,
    variables?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    const res = await this.fetchImpl(ANILIST_GRAPHQL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
      },
      body: JSON.stringify({ query, variables }),
      ...(signal ? { signal } : {}),
    });

    let body: GraphQLResponse<T> | undefined;
    try {
      body = (await res.json()) as GraphQLResponse<T>;
    } catch {
      body = undefined;
    }

    const firstError = body?.errors?.[0]?.message;

    if (!res.ok) {
      if (isAuthFailure(res.status, firstError)) {
        throw new AniListAuthError(
          firstError ?? "AniList rejected the saved token. Reconnect to continue syncing.",
        );
      }
      // 429 and 5xx are worth retrying; the outbox backs off for us.
      throw new AniListRemoteError(
        `AniList API error ${res.status}${firstError ? `: ${firstError}` : ""}`,
      );
    }

    if (firstError) {
      if (isAuthFailure(body?.errors?.[0]?.status ?? 200, firstError)) {
        throw new AniListAuthError(firstError);
      }
      throw new AniListRemoteError(firstError);
    }

    if (!body?.data) throw new AniListRemoteError("AniList returned an empty response.");
    return body.data;
  }
}
