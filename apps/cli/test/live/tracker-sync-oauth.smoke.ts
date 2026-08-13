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
 *   KUNAI_LIVE_SYNC_TMDB_MOVIE_ID=550
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
          const movieId = Number(process.env.KUNAI_LIVE_SYNC_TMDB_MOVIE_ID ?? 550);
          const tmdbTarget = { tracker: "tmdb", tmdbId: movieId, mediaKind: "movie" } as const;
          const watchlistOn: TrackerOperation = {
            version: 1,
            kind: "list-membership:set",
            target: tmdbTarget,
            list: "watchlist",
            present: true,
          };
          record("tmdb watchlist add", await tmdb.apply(watchlistOn, options));
          record("tmdb watchlist add again is idempotent", await tmdb.apply(watchlistOn, options));
          record(
            "tmdb watchlist remove (cleanup)",
            await tmdb.apply({ ...watchlistOn, present: false }, options),
          );
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
