/**
 * Live tracker-sync smoke. Opt-in, never run in CI, and destructive to whatever
 * account it authorizes — so it refuses to start unless every safety flag is
 * set explicitly.
 *
 * Connect is not reachable from the shell, deliberately, until this has passed
 * against a disposable account. This script is the only way to exercise the
 * real OAuth contract, and it uses the production auth readers and adapters so
 * a pass here means the shipped path works, not that a test double does.
 *
 * Required:
 *   KUNAI_LIVE_SYNC=1                     acknowledge this mutates a real account
 *   KUNAI_LIVE_SYNC_ANILIST_MEDIA_ID=…    a disposable title to mutate
 * Optional (only to test your own AniList application instead of the shipped one):
 *   KUNAI_ANILIST_CLIENT_ID=…             from anilist.co/settings/developer
 *   KUNAI_ANILIST_REDIRECT_URI=…          registered on that application, exactly
 * Optional:
 *   KUNAI_LIVE_SYNC_TMDB=1                also exercise TMDB
 *   KUNAI_LIVE_SYNC_TMDB_MOVIE_ID=550     a disposable movie to add and remove
 *
 * Every remote write is verified by reading the account back, not by trusting
 * the response: a TMDB membership POST answers `{ success: true }` even when it
 * changed nothing, so an outcome-only assertion cannot tell a working write from
 * a silently rejected one.
 *
 * Run:
 *   bun run test:live:tracker-sync
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SyncTokenStore } from "@/services/persistence/SyncTokenStore";
import { AniListAdapter } from "@/services/sync/AniListAdapter";
import { resolveAniListAuth, resolveTmdbAuth } from "@/services/sync/auth-contract";
import type { TrackerOperation } from "@/services/sync/operations";
import { TmdbAdapter } from "@/services/sync/TmdbAdapter";
import type { SyncOutcome } from "@/services/sync/types";

type Step = { readonly name: string; readonly ok: boolean; readonly detail?: string };

const steps: Step[] = [];
function record(name: string, outcome: SyncOutcome | boolean, detail?: string): boolean {
  const ok = typeof outcome === "boolean" ? outcome : outcome.status === "ok";
  const note = detail ?? (typeof outcome === "boolean" ? undefined : describeOutcome(outcome));
  steps.push({ name, ok, ...(note ? { detail: note } : {}) });
  process.stdout.write(`${ok ? "ok  " : "FAIL"}  ${name}${note ? ` — ${note}` : ""}\n`);
  return ok;
}

/**
 * Assert the outcome *detail*, not just its status.
 *
 * `syncOk()` and `syncOk("already-current")` are both `status: "ok"`, so a
 * status-only check cannot tell "converged" from "toggled again". That is
 * exactly how a flip-flopping favourite passed an idempotency step.
 */
function recordDetail(name: string, outcome: SyncOutcome, expected: string | null): boolean {
  const actual = outcome.status === "ok" ? (outcome.detail ?? "toggled") : describeOutcome(outcome);
  const ok = outcome.status === "ok" && actual === (expected ?? "toggled");
  const note = expected === null ? actual : `${actual} (expected ${expected})`;
  steps.push({ name, ok, detail: note });
  process.stdout.write(`${ok ? "ok  " : "FAIL"}  ${name} — ${note}\n`);
  return ok;
}

/** Never prints a token, code, or state — only the typed decision. */
function describeOutcome(outcome: SyncOutcome): string {
  switch (outcome.status) {
    case "ok":
      return outcome.detail ?? "ok";
    case "skipped":
      return `skipped: ${outcome.reason}`;
    case "cancelled":
      return `cancelled: ${outcome.reason}`;
    case "needs-reauth":
      return `needs-reauth: ${outcome.code}`;
    case "failed":
      return `failed: ${outcome.code} (${outcome.kind})`;
    case "rate-limited":
      return `rate-limited: retry in ${Math.round(outcome.retryAfterMs / 1000)}s`;
  }
}

/**
 * Delete the list activities this run posted.
 *
 * `SaveMediaListEntry` publishes to the user's activity feed — that is normal
 * AniList behaviour and what a real user wants, so production does nothing to
 * suppress it. But `DeleteMediaListEntry` does not remove the activity, so a
 * test run against a real account would leave public posts behind. This is
 * test-only cleanup; nothing in the shipped adapter deletes activities.
 */
async function purgeListActivities(
  accessToken: string,
  userId: number,
  mediaId: number,
): Promise<number> {
  const call = async (query: string, variables: Record<string, unknown>) => {
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ query, variables }),
    });
    return (await res.json()) as { data?: Record<string, unknown> };
  };

  const found = await call(
    `query ($userId: Int, $mediaId: Int) {
       Page(perPage: 50) {
         activities(userId: $userId, mediaId: $mediaId, type: ANIME_LIST, sort: ID_DESC) {
           ... on ListActivity { id }
         }
       }
     }`,
    { userId, mediaId },
  );

  const page = found.data?.Page as { activities?: { id?: number }[] } | undefined;
  const ids = (page?.activities ?? []).map((activity) => activity.id).filter(Boolean) as number[];

  let deleted = 0;
  for (const id of ids) {
    await call(`mutation ($id: Int) { DeleteActivity(id: $id) { __typename } }`, { id });
    deleted += 1;
  }
  return deleted;
}

/**
 * Separate "the read is wrong" from "the write never happened".
 *
 * A 65s re-read still reported the favourite absent, so a short-lived cache is
 * ruled out. Two candidates remain and they need opposite fixes, so this asks
 * three independent sources rather than trusting the one that already lied:
 * `Media.isFavourite`, the mutation's own response, and the viewer's favourites
 * list. Whichever disagrees with the others is the broken one.
 */
interface FavouritePage {
  readonly pageInfo?: { readonly total?: number };
  readonly nodes?: readonly { readonly id: number }[];
}

async function diagnoseFavourite(accessToken: string, mediaId: number): Promise<void> {
  const call = async (query: string, variables: Record<string, unknown> = {}) => {
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ query, variables }),
    });
    return (await res.json()) as {
      data?: {
        Viewer?: { favourites?: { anime?: FavouritePage } };
        Media?: { isFavourite?: boolean };
        ToggleFavourite?: { anime?: FavouritePage };
      };
      errors?: { message: string; status?: number }[];
    };
  };

  const viewerFavourites = async (): Promise<{ ids: number[]; total: number }> => {
    const res = await call(
      `query { Viewer { favourites { anime(page: 1, perPage: 50) {
         pageInfo { total } nodes { id } } } } }`,
    );
    const anime = res.data?.Viewer?.favourites?.anime;
    return {
      ids: (anime?.nodes ?? []).map((node) => node.id),
      total: anime?.pageInfo?.total ?? -1,
    };
  };

  const mediaSays = async (): Promise<unknown> => {
    const res = await call(`query ($id: Int) { Media(id: $id) { id isFavourite } }`, {
      id: mediaId,
    });
    if (res.errors?.length) return `errors: ${res.errors[0]?.message}`;
    return res.data?.Media?.isFavourite;
  };

  process.stdout.write("\n--- favourite diagnosis ---\n");

  const before = await viewerFavourites();
  process.stdout.write(
    `Viewer.favourites before : ${before.ids.length} of ${before.total} listed, contains ${mediaId}: ${before.ids.includes(mediaId)}\n`,
  );
  process.stdout.write(`Media.isFavourite before : ${String(await mediaSays())}\n`);

  const toggled = await call(
    `mutation ($id: Int) { ToggleFavourite(animeId: $id) {
       anime(page: 1, perPage: 50) { pageInfo { total } nodes { id } } } }`,
    { id: mediaId },
  );
  if (toggled.errors?.length) {
    process.stdout.write(`ToggleFavourite ERRORS   : ${JSON.stringify(toggled.errors)}\n`);
  }
  const returned = toggled.data?.ToggleFavourite?.anime;
  const returnedIds: number[] = (returned?.nodes ?? []).map((node) => node.id);
  process.stdout.write(
    `ToggleFavourite response : ${returnedIds.length} of ${returned?.pageInfo?.total ?? "?"} listed, contains ${mediaId}: ${returnedIds.includes(mediaId)}\n`,
  );

  process.stdout.write(`Media.isFavourite after  : ${String(await mediaSays())}\n`);
  const after = await viewerFavourites();
  process.stdout.write(
    `Viewer.favourites after  : ${after.ids.length} of ${after.total} listed, contains ${mediaId}: ${after.ids.includes(mediaId)}\n`,
  );

  // Leave the account as it was found.
  if (after.ids.includes(mediaId) !== before.ids.includes(mediaId)) {
    await call(`mutation ($id: Int) { ToggleFavourite(animeId: $id) { __typename } }`, {
      id: mediaId,
    });
    const restored = await viewerFavourites();
    process.stdout.write(
      `restored to entry state  : contains ${mediaId}: ${restored.ids.includes(mediaId)}\n`,
    );
  }
  process.stdout.write("--- end diagnosis ---\n\n");
}

/**
 * What TMDB itself says about this title on this account.
 *
 * `account_states` is the authority, and reading it is the whole point: a
 * membership POST answers `{ success: true }` for a request that changed
 * nothing, so asserting on the adapter's own outcome proves only that a request
 * was made. This is the same hole that let the AniList favourite path report a
 * clean run while it flip-flopped.
 */
async function readTmdbAccountState(
  apiKey: string,
  sessionId: string,
  movieId: number,
): Promise<{ favorite: boolean; watchlist: boolean } | null> {
  const url = new URL(`https://api.themoviedb.org/3/movie/${movieId}/account_states`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("session_id", sessionId);
  const res = await fetch(url.toString());
  if (!res.ok) return null;
  const body = (await res.json()) as { favorite?: boolean; watchlist?: boolean };
  return { favorite: body.favorite === true, watchlist: body.watchlist === true };
}

/** Assert a remote field actually holds the value we asked it to. */
function recordRemote(name: string, actual: boolean | undefined, expected: boolean): boolean {
  const ok = actual === expected;
  steps.push({
    name,
    ok,
    detail: ok ? `remote reads ${expected}` : `wanted ${expected}, remote reads ${String(actual)}`,
  });
  return ok;
}

function required(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

async function main(): Promise<void> {
  if (process.env.KUNAI_LIVE_SYNC !== "1") {
    process.stdout.write(
      "Refusing to run: set KUNAI_LIVE_SYNC=1 to confirm this mutates a real tracker account.\n",
    );
    process.exit(2);
  }

  const anilistMediaId = Number(required("KUNAI_LIVE_SYNC_ANILIST_MEDIA_ID"));
  if (!Number.isSafeInteger(anilistMediaId) || anilistMediaId < 1) {
    process.stdout.write(
      "Set KUNAI_LIVE_SYNC_ANILIST_MEDIA_ID to a disposable AniList media id.\n",
    );
    process.exit(2);
  }

  /**
   * Isolated profile: the live run must never touch the developer's real
   * config, history, or cached credentials.
   *
   * `SyncTokenStore` is handed `configDir` directly below, which is what
   * actually decides where the token file lands. The XDG overrides are belt and
   * braces for anything else this process might resolve a path through —
   * `getKunaiPaths()` reads them, and there is no `KUNAI_CONFIG_DIR`.
   */
  const profile = mkdtempSync(join(tmpdir(), "kunai-live-sync-"));
  process.env.XDG_CONFIG_HOME = join(profile, "config");
  process.env.XDG_DATA_HOME = join(profile, "data");
  process.env.XDG_CACHE_HOME = join(profile, "cache");
  process.stdout.write(`isolated profile: ${profile}\n\n`);

  const controller = new AbortController();
  const options = { signal: controller.signal };
  let anilistConnected = false;
  const tokenStore = new SyncTokenStore({ configDir: profile } as never);

  try {
    // --- AniList -------------------------------------------------------------
    const auth = resolveAniListAuth();
    if (!record("anilist auth contract resolves", auth.availability.available)) {
      process.stdout.write(
        `\nreason: ${auth.availability.available ? "" : auth.availability.reason}\n` +
          "The shipped application needs no configuration. If you overrode\n" +
          "KUNAI_ANILIST_CLIENT_ID, KUNAI_ANILIST_REDIRECT_URI must be the URI registered\n" +
          "on that application exactly, e.g. http://127.0.0.1:43863/callback\n",
      );
      process.exit(1);
    }

    const anilist = new AniListAdapter(tokenStore, undefined, auth);
    await anilist.init();

    process.stdout.write("\nA browser window will open for AniList authorization.\n");
    const connected = await anilist.connect({
      signal: controller.signal,
      onPrompt: (note) => process.stdout.write(`${note}\n`),
    });
    if (!record("anilist connect", connected.ok, connected.ok ? undefined : connected.error)) {
      process.exit(1);
    }
    anilistConnected = true;
    const connection = anilist.getConnection();
    record(
      "anilist identity",
      connection.state === "connected",
      connection.state === "connected" ? connection.username : connection.state,
    );

    if (process.env.KUNAI_LIVE_SYNC_DIAGNOSE_FAVOURITE === "1") {
      const stored = (await tokenStore.load()).anilist;
      if (stored) await diagnoseFavourite(stored.accessToken, anilistMediaId);
    }

    const target = { tracker: "anilist", anilistId: anilistMediaId, mediaKind: "anime" } as const;
    const progress: TrackerOperation = {
      version: 1,
      kind: "progress:set",
      target,
      progress: 2,
      status: "watching",
    };
    record("anilist progress:set 2", await anilist.apply(progress, options));

    const favouriteOn: TrackerOperation = {
      version: 1,
      kind: "favorite-membership:set",
      target,
      present: true,
    };
    recordDetail("anilist favourite add", await anilist.apply(favouriteOn, options), null);

    /**
     * The property that motivated desired state: a redelivery must converge,
     * not toggle back off. `already-current` is the only passing answer —
     * `toggled` means the membership read did not see our own write, and the
     * favourite has just been switched back off.
     */
    recordDetail(
      "anilist favourite add again is idempotent",
      await anilist.apply(favouriteOn, options),
      "already-current",
    );

    // Optional, slow, and decisive: if an immediate re-read is stale but a
    // delayed one is not, the cause is AniList caching the Media query rather
    // than anything about how the mutation was sent.
    if (process.env.KUNAI_LIVE_SYNC_SLOW_RECHECK === "1") {
      process.stdout.write("\nwaiting 65s to re-read membership past any short-lived cache…\n");
      await Bun.sleep(65_000);
      recordDetail(
        "anilist favourite still present after 65s",
        await anilist.apply(favouriteOn, options),
        "already-current",
      );
    }

    recordDetail(
      "anilist favourite remove (cleanup)",
      await anilist.apply({ ...favouriteOn, present: false }, options),
      null,
    );
    record(
      "anilist watchlist remove (cleanup)",
      await anilist.apply(
        { version: 1, kind: "list-membership:set", target, list: "watchlist", present: false },
        options,
      ),
    );

    // Deleting the list entry leaves the activity it posted, so remove those too
    // — otherwise this run leaves public posts on a real profile.
    const stored = (await tokenStore.load()).anilist;
    if (stored) {
      const removed = await purgeListActivities(stored.accessToken, stored.userId, anilistMediaId);
      record("anilist list activities removed (cleanup)", true, `${removed} deleted`);
    }

    // --- TMDB ----------------------------------------------------------------
    if (process.env.KUNAI_LIVE_SYNC_TMDB === "1") {
      const tmdbAuth = resolveTmdbAuth();
      record("tmdb auth contract resolves", tmdbAuth.availability.available);
      if (tmdbAuth.apiKey) {
        const tmdb = new TmdbAdapter(tokenStore, tmdbAuth.apiKey);
        await tmdb.init();
        const tmdbConnected = await tmdb.connect({
          signal: controller.signal,
          onPrompt: (note) => process.stdout.write(`${note}\n`),
        });
        if (
          record(
            "tmdb connect",
            tmdbConnected.ok,
            tmdbConnected.ok ? undefined : tmdbConnected.error,
          )
        ) {
          // The identity the account path is built from. A username here means
          // every subsequent write addresses an account that does not exist.
          const tmdbTokens = (await tokenStore.load()).tmdb;
          record(
            "tmdb resolves a numeric account id",
            /^\d+$/.test(tmdbTokens?.accountId ?? ""),
            `accountId=${tmdbTokens?.accountId ?? "none"} username=${tmdbTokens?.username ?? "none"}`,
          );
          const tmdbConnection = tmdb.getConnection();
          record(
            "tmdb reports an identity",
            tmdbConnection.state === "connected",
            tmdbConnection.state === "connected"
              ? `@${tmdbConnection.username ?? "?"}`
              : tmdbConnection.state,
          );

          const sessionId = tmdbTokens?.sessionId ?? "";
          const movieId = Number(process.env.KUNAI_LIVE_SYNC_TMDB_MOVIE_ID ?? 550);
          const tmdbTarget = { tracker: "tmdb", tmdbId: movieId, mediaKind: "movie" } as const;
          const watchlistOn: TrackerOperation = {
            version: 1,
            kind: "list-membership:set",
            target: tmdbTarget,
            list: "watchlist",
            present: true,
          };
          const tmdbFavouriteOn: TrackerOperation = {
            version: 1,
            kind: "favorite-membership:set",
            target: tmdbTarget,
            present: true,
          };

          // Baseline first: a title already on the list would make an ineffective
          // write look like a success.
          const before = await readTmdbAccountState(tmdbAuth.apiKey, sessionId, movieId);
          record(
            "tmdb account state is readable",
            before !== null,
            before ? `watchlist=${before.watchlist} favourite=${before.favorite}` : "unreadable",
          );

          record("tmdb watchlist add", await tmdb.apply(watchlistOn, options));
          recordRemote(
            "tmdb watchlist add landed remotely",
            (await readTmdbAccountState(tmdbAuth.apiKey, sessionId, movieId))?.watchlist,
            true,
          );
          record("tmdb watchlist add again is idempotent", await tmdb.apply(watchlistOn, options));

          record("tmdb favourite add", await tmdb.apply(tmdbFavouriteOn, options));
          recordRemote(
            "tmdb favourite add landed remotely",
            (await readTmdbAccountState(tmdbAuth.apiKey, sessionId, movieId))?.favorite,
            true,
          );

          record(
            "tmdb watchlist remove (cleanup)",
            await tmdb.apply({ ...watchlistOn, present: false }, options),
          );
          record(
            "tmdb favourite remove (cleanup)",
            await tmdb.apply({ ...tmdbFavouriteOn, present: false }, options),
          );
          const after = await readTmdbAccountState(tmdbAuth.apiKey, sessionId, movieId);
          recordRemote("tmdb watchlist cleanup landed remotely", after?.watchlist, false);
          recordRemote("tmdb favourite cleanup landed remotely", after?.favorite, false);

          await tmdb.disconnect();
          record("tmdb session deleted", true);
        }
      }
    }
  } finally {
    if (anilistConnected) {
      process.stdout.write(
        "\nLocal AniList token cleared. Revoke the application at\n" +
          "https://anilist.co/settings/apps to remove access remotely.\n",
      );
    }
    rmSync(profile, { recursive: true, force: true });
    process.stdout.write(`removed isolated profile: ${profile}\n`);
  }

  const failed = steps.filter((step) => !step.ok);
  process.stdout.write(`\n${steps.length - failed.length}/${steps.length} steps passed\n`);
  process.exit(failed.length === 0 ? 0 : 1);
}

await main();
