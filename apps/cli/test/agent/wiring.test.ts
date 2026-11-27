/**
 * L2 wiring scenarios — the tests plan 010 was blocked on. Each one drives the
 * REAL root shell + session loop with keystrokes and asserts BOTH the rendered
 * frame and the committed SQLite/config state in the same run, catching the
 * failure class unit tests cannot see: the silent no-op (a key that updates
 * the screen but writes nothing, a flag persisted but never read).
 *
 * One session per test — sessions share process env, so they are sequential,
 * never concurrent (the driver enforces this with a throwing guard).
 */
import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import type { Container } from "@/container";
import { RecommendationCacheRepository } from "@kunai/storage";
import type { JsonObject } from "@kunai/types";

import { createAgentSession, type AgentSession } from "./agent-driver";
import { K } from "./keys";
import { onboardedConfig } from "./seed";

const SETTINGS_KEY = "/";

describe("agent wiring · recommendation refresh", () => {
  it("keeps the highlighted search result as the download target after late picks arrive", async () => {
    const picksRequested = Promise.withResolvers<void>();
    const releasePicks = Promise.withResolvers<void>();
    const picksMapped = Promise.withResolvers<void>();
    let readResults: (() => readonly string[]) | undefined;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      async (url: Parameters<typeof fetch>[0]) => {
        if (!String(url).includes("/trending/all/week")) throw new Error("fixture request only");
        picksRequested.resolve();
        await releasePicks.promise;
        return Response.json({
          results: [{ id: 854, media_type: "movie", title: "Late Recommendation" }],
        });
      },
      { preconnect: originalFetch.preconnect },
    );
    try {
      await withSession(
        "wiring-late-picks",
        {
          bootstrap: { initialRoute: "recommendation" },
          beforeMount({ container }) {
            readResults = () => container.stateManager.getState().searchResults.map((r) => r.title);
            container.downloadService.getEnqueueEligibility = () => ({ allowed: true });
            const service = container.resultEnrichmentService;
            const enrich = service.enrichResults.bind(service);
            service.enrichResults = async (results, options) => {
              const enriched = await enrich(results, options);
              if (options?.preloadedHistory && results[0]?.title === "Late Recommendation") {
                setImmediate(picksMapped.resolve);
              }
              return enriched;
            };
          },
        },
        async (s) => {
          await s.waitForFrame((f) => f.includes("Finding something to watch"), "cold picks");
          await picksRequested.promise;
          s.press("smoke", K.enter);
          await s.waitForFrame((f) => f.includes("▌ Smoke Movie"), "search results");
          releasePicks.resolve();
          await picksMapped.promise;
          expect(s.frame()).toContain("▌ Smoke Movie");
          s.press("d");
          await s.waitForFrame((f) => /Download .+\?/u.test(f), "download confirmation");
          expect(s.frame()).toContain("Download Smoke Movie?");
          expect(readResults?.()).toEqual(["Smoke Movie", "Smoke Series"]);
        },
      );
    } finally {
      releasePicks.resolve();
      globalThis.fetch = originalFetch;
    }
  });
});

describe("agent wiring · first-run browse focus", () => {
  it("makes recommendation-list keyboard ownership explicit before typed input", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      () => Promise.reject(new Error("network disabled for deterministic first-run focus test")),
      { preconnect: originalFetch.preconnect },
    );
    try {
      await withSession(
        "wiring-first-run-focus",
        {
          columns: 54,
          rows: 25,
          bootstrap: { initialRoute: "recommendation" },
          beforeMount({ container }) {
            const now = Date.now();
            new RecommendationCacheRepository(container.cacheDb).set(
              "catalog:trending:series",
              JSON.stringify({
                cachedAt: now,
                sourceId: "tmdb",
                results: [
                  {
                    id: "tmdb:smoke-movie-1",
                    type: "movie",
                    title: "Smoke Movie",
                    year: "2026",
                    overview: "Compiled smoke movie",
                    posterPath: null,
                  },
                ],
              }),
              new Date(now + 14 * 24 * 60 * 60 * 1000).toISOString(),
              new Date(now).toISOString(),
            );
          },
        },
        async (s) => {
          await s.waitForFrame(
            (f) => f.includes("Search title") && f.includes("Smoke Movie"),
            "first-run recommendation surface",
            20_000,
          );

          expect(s.frame()).toContain("results own keys · Esc search");

          s.press("series");
          await s.waitSettled();
          expect(s.frame()).not.toContain("⌕ series");

          s.press(K.esc);
          await s.waitForFrame((f) => f.includes("⌕"), "search field focused");
          s.press("series");
          await s.waitForFrame((f) => f.includes("series"), "query draft visible");
          s.press(K.enter);
          await s.waitForFrame((f) => f.includes("Smoke Series"), "typed query searched");
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 45_000);
});

async function withSession(
  label: string,
  options: Parameters<typeof createAgentSession>[0],
  run: (session: AgentSession) => Promise<void>,
): Promise<void> {
  const session = await createAgentSession({ ...options, label });
  try {
    await run(session);
    session.assertPrivacyClean();
  } finally {
    await session.dispose();
  }
}

describe("agent wiring · settings toggle", () => {
  it("footer hints: Minimal persists to config.json and back", async () => {
    await withSession("wiring-settings", {}, async (s) => {
      await s.waitForFrame((f) => f.includes("Search title"), "browse shell");

      // Open the palette → /settings → Footer hints submenu → Minimal.
      // Each step waits for its surface — a human does the same; typing into a
      // palette that hasn't rendered yet drops keys (verified by failure).
      s.press(SETTINGS_KEY);
      await s.waitForFrame((f) => f.includes("command"), "command palette");
      s.press("settings", K.enter);
      await s.waitForFrame((f) => f.includes("Footer hints"), "settings panel");
      // The panel frame renders before its input handlers are fully attached —
      // keys sent into that gap are dropped (verified: immediate Down+Enter
      // never opened the submenu). A human's next keystroke lands after seeing
      // the settled surface; waitSettled is that beat.
      await s.waitSettled();
      s.press(K.down, K.enter);
      await s.waitForFrame((f) => f.includes("Minimal"), "footer-hints submenu");
      // Same input-attach gap as the panel: keys sent the instant the submenu
      // renders can be dropped — and "Minimal" matches the open submenu's
      // option row even when nothing was picked, so the frame predicate alone
      // can't tell pick from no-op. Settle, then assert the PICKED state:
      // the submenu closes and the General panel list returns — Mascot & tips
      // still lives in General after the five-section merge; Usage analytics
      // moved to Privacy & System.
      await s.waitSettled();
      s.press(K.down, K.enter);
      await s.waitForFrame(
        (f) => f.includes("Mascot & tips") && f.includes("Minimal"),
        "pick applied — panel shows Minimal",
      );

      // Frame claims it AND the debounced config write lands — both required.
      await s.waitForBackend(
        (i) => i.config().footerHints === "minimal",
        "config.footerHints === minimal",
      );

      // Reverse the same path — a one-way door is a bug, not a feature.
      // Verified: the cursor stays on the picked row, so Enter reopens the
      // submenu with the cursor already on Detailed — no navigation through
      // unrelated sections (hazard 3 is a real risk of sloppy key plans).
      s.press(K.enter);
      await s.waitForFrame((f) => f.includes("Detailed"), "footer-hints submenu again");
      await s.waitSettled();
      s.press(K.enter);
      await s.waitForFrame(
        (f) => f.includes("Mascot & tips") && f.includes("Detailed"),
        "pick applied — panel shows Detailed",
      );
      await s.waitForBackend(
        (i) => i.config().footerHints === "detailed" || i.config().footerHints === undefined,
        "config.footerHints back to detailed",
      );
    });
  }, 30_000);
});

describe("agent wiring · queue", () => {
  it("q enqueues the highlighted result; x removes it in Up Next", async () => {
    await withSession("wiring-queue", {}, async (s) => {
      await s.waitForFrame((f) => f.includes("Search title"), "browse shell");

      s.press("movie", K.enter);
      await s.waitForFrame((f) => f.includes("Smoke Movie"), "fixture results");

      // `q` on the highlighted row — advertised as "up next" in the footer.
      const before = s.inspect().queue().length;
      s.press("q");
      await s.waitForBackend((i) => i.queue().length === before + 1, "playlist_queue +1 after q");
      const queued = s.inspect().queue();
      expect(queued.at(-1)?.title_id).toBe("tmdb:smoke-movie-1");

      // `Q` opens Up Next; `x` removes the selected row — reverse state. The
      // predicate must name the overlay uniquely: "Smoke Movie" also appears
      // on the results frame, which let the wait resolve before the overlay's
      // input handler attached — x then dropped into the gap and removed
      // nothing. waitSettled is the human beat between seeing the panel and
      // pressing a key on it.
      s.press("Q");
      await s.waitForFrame((f) => f.includes("UP NEXT"), "up-next surface");
      await s.waitSettled();
      // `x` arms on first press (prompt names the row in the footer) and
      // removes on the second — single-press removal would be one key away
      // from an accident next to Ctrl+C.
      s.press("x");
      await s.waitForFrame((f) => f.includes("Press x again"), "remove confirm prompt");
      await s.waitSettled();
      s.press("x");
      await s.waitForBackend(
        (i) => i.queue().length === before,
        "playlist_queue back to baseline after x",
      );
    });
  }, 30_000);
});

describe("agent wiring · session undo", () => {
  it("q → strip offers z → z restores playlist_queue exactly", async () => {
    await withSession("wiring-undo-queue", {}, async (s) => {
      await s.waitForFrame((f) => f.includes("Search title"), "browse shell");

      s.press("movie", K.enter);
      await s.waitForFrame((f) => f.includes("Smoke Movie"), "fixture results");

      const baseline = s.inspect().queue();
      s.press("q");
      await s.waitForBackend(
        (i) => i.queue().length === baseline.length + 1,
        "playlist_queue +1 after q",
      );
      // The affordance is a frame claim AND a DB fact: strip advertises z
      // while the row sits committed underneath it.
      await s.waitForFrame((f) => f.includes("added to queue · z undo"), "undo strip");

      s.press("z");
      await s.waitForFrame((f) => f.includes("undid queue add"), "undo outcome line");
      await s.waitForBackend(
        (i) => i.queue().length === baseline.length,
        "playlist_queue back to baseline after z",
      );

      // The undo wrote nothing new to undo: a second z is a silent no-op —
      // no error surface, no strip, no DB drift.
      const frameAfterUndo = s.frame();
      s.press("z");
      await s.waitSettled();
      expect(s.frame()).toBe(frameAfterUndo);
      expect(s.inspect().queue().length).toBe(baseline.length);
    });
  }, 30_000);

  it("x inside Up Next journals a removal that z reverses", async () => {
    await withSession("wiring-undo-remove", {}, async (s) => {
      await s.waitForFrame((f) => f.includes("Search title"), "browse shell");

      s.press("movie", K.enter);
      await s.waitForFrame((f) => f.includes("Smoke Movie"), "fixture results");
      s.press("q");
      await s.waitForBackend((i) => i.queue().length === 1, "queued");
      // Consume the add's undo affordance so the remove is what z pops.
      s.press("z");
      await s.waitForBackend((i) => i.queue().length === 0, "add undone");
      s.press("q");
      await s.waitForBackend((i) => i.queue().length === 1, "queued again");

      s.press("Q");
      await s.waitForFrame((f) => f.includes("UP NEXT"), "up-next surface");
      await s.waitSettled();
      // Destructive remove is two-press: first x arms the row-keyed confirm,
      // the second executes and is what the undo journal must capture.
      s.press("x");
      await s.waitForFrame((f) => f.includes("again to remove"), "remove armed");
      s.press("x");
      await s.waitForBackend((i) => i.queue().length === 0, "x removed the row");

      s.press("z");
      await s.waitForBackend(
        (i) => i.queue().length === 1 && i.queue()[0]?.status === "pending",
        "z restored the removed row",
      );
    });
  }, 45_000);
});

describe("agent wiring · post-play history", () => {
  it("a played title lands in history_progress", async () => {
    await withSession("wiring-history", { mpv: "fake" }, async (s) => {
      await s.waitForFrame((f) => f.includes("Search title"), "browse shell");

      s.press("movie", K.enter);
      await s.waitForFrame((f) => f.includes("Smoke Movie"), "fixture results");
      s.press(K.enter);
      // Fake-mpv playback runs a real process spawn + EOF path — on a loaded
      // CI runner that exceeds the default 10s frame budget.
      await s.waitForFrame((f) => f.includes("Post-play"), "post-play surface", 30_000);

      await s.waitForBackend(
        (i) => i.history().some((row) => row.title_id === "tmdb:smoke-movie-1"),
        "history_progress contains the played title",
      );
    });
  }, 45_000);
});

describe("agent wiring · anime episode picker", () => {
  it("opens with the cursor on an episode, so one Enter plays it", async () => {
    // The picker used to open on nothing when the current episode was not in
    // the list (here: episode 1 of a title offering only 7), so Enter was a
    // silent no-op until the user pressed ↓.
    await withSession("wiring-anime-episode", { mpv: "fake" }, async (s) => {
      await s.waitForFrame((f) => f.includes("Search title"), "browse shell");
      s.press(K.tab);
      await s.waitForFrame((f) => f.includes("anime"), "anime mode");
      s.press("smoke", K.enter);
      await s.waitForFrame((f) => f.includes("Smoke Anime"), "anime fixture results");
      s.press(K.enter);
      await s.waitForFrame((f) => f.includes("▌ Episode 7"), "episode picker with a cursor");
      await s.waitSettled();
      s.press(K.enter);
      await s.waitForFrame((f) => f.includes("Post-play"), "post-play surface", 30_000);

      await s.waitForBackend(
        (i) =>
          i
            .history()
            .some((row) => row.title_id === "anilist:smoke-anime-1" && row.media_kind === "anime"),
        "history_progress records the anime episode",
      );
    });
  }, 45_000);
});

describe("agent wiring · next up on the home row", () => {
  it("a finished episode with a later aired one offers it, and Enter plays it", async () => {
    // Episode 1 finished; the release cache knows episode 6 aired long ago,
    // so reconciliation calls the title caught-up (nothing aired since the
    // last watch). The home row must still offer episode 2.
    const finishedAt = "2026-11-20T10:00:00.000Z";
    const seedNextUp = ({ container }: { readonly container: Container }) => {
      container.historyRepository.upsertProgress({
        title: { id: "tmdb:smoke-series-1", kind: "series", title: "Smoke Series" },
        episode: { season: 1, episode: 1 },
        positionSeconds: 1400,
        durationSeconds: 1400,
        completed: true,
        // The fixture provider stands in for videasy; real rows always carry
        // the provider they played on.
        providerId: "videasy",
        updatedAt: finishedAt,
      });
      container.releaseProgressCache.upsert({
        titleId: "tmdb:smoke-series-1",
        mediaKind: "series",
        source: "tmdb",
        title: "Smoke Series",
        anchorSeason: 1,
        anchorEpisode: 1,
        latestAiredSeason: 1,
        latestAiredEpisode: 6,
        newEpisodeCount: 0,
        status: "caught-up",
        checkedAt: finishedAt,
        nextCheckAt: "2999-01-01T00:00:00.000Z",
        staleAfterAt: "2999-01-01T00:00:00.000Z",
        sourceFingerprint: "wiring:next-up",
        errorCount: 0,
      });
    };

    await withSession("wiring-next-up", { mpv: "fake", beforeMount: seedNextUp }, async (s) => {
      await s.waitForFrame(
        (f) => f.includes("Smoke Series") && f.includes("next · S01E02"),
        "next-up continue row",
      );
      await s.waitSettled();

      // ↓ leaves the search box for "For you now", as the footer says.
      s.press(K.down);
      await s.waitForFrame((f) => f.includes("↵ play next"), "focused next-up row");
      await s.waitSettled();
      s.press(K.enter);
      await s.waitForFrame((f) => f.includes("Post-play"), "post-play surface", 30_000);

      await s.waitForBackend(
        (i) =>
          i
            .history()
            .some(
              (row) =>
                row.title_id === "tmdb:smoke-series-1" && row.season === 1 && row.episode === 2,
            ),
        "history_progress records episode 2, the next-up target",
      );
    });
  }, 45_000);
});

describe("agent wiring · notifications inbox", () => {
  /**
   * The harness has no signal producer wired to the fixture catalog, so the
   * notice is written the way NotificationService persists it — a row in the
   * notifications table with the full media identity in item_json. Reads are
   * live (NotificationService.listActive queries per open), so a post-boot
   * insert surfaces like a real notice.
   */
  function seedEpisodeNotification(
    session: AgentSession,
    notice: {
      readonly dedupKey: string;
      readonly title: string;
      readonly body: string;
      readonly item: JsonObject;
    },
  ): void {
    const db = new Database(join(session.profile.paths.dataDir, "kunai-data.sqlite"));
    try {
      const now = new Date().toISOString();
      db.query(
        `INSERT INTO notifications
           (id, dedup_key, kind, title, body, item_json, action_json, created_at, updated_at)
         VALUES (?, ?, 'new-episode', ?, ?, ?, '["dismiss"]', ?, ?)`,
      ).run(
        `seed-${notice.dedupKey}`,
        notice.dedupKey,
        notice.title,
        notice.body,
        JSON.stringify(notice.item),
        now,
        now,
      );
    } finally {
      db.close();
    }
  }

  it("Enter on an episode notice plays it through the awaited inbox route", async () => {
    await withSession("wiring-inbox-play", { mpv: "fake" }, async (s) => {
      await s.waitForFrame((f) => f.includes("Search title"), "browse shell");
      seedEpisodeNotification(s, {
        dedupKey: "wiring:smoke-series-s1e2",
        title: "Smoke Series S01E02 available",
        body: "episode 2 just landed",
        item: {
          mediaKind: "series",
          contentType: "series",
          titleId: "tmdb:smoke-series-1",
          title: "Smoke Series",
          season: 1,
          episode: 2,
        },
      });

      // Awaited route: the browse palette's /notifications awaits the outcome
      // bridge — Enter resolves a playback outcome into a history-entry.
      s.press("/");
      await s.waitForFrame((f) => f.includes("command"), "command palette");
      s.press("notifications", K.enter);
      await s.waitForFrame((f) => f.includes("Smoke Series S01E02"), "inbox row");
      await s.waitSettled();

      s.press(K.enter);
      await s.waitForFrame((f) => f.includes("Post-play"), "post-play surface", 30_000);

      await s.waitForBackend(
        (i) =>
          i
            .history()
            .some(
              (row) =>
                row.title_id === "tmdb:smoke-series-1" && row.season === 1 && row.episode === 2,
            ),
        "history_progress contains the announced episode",
      );
    });
  }, 45_000);

  it("Enter self-delivers a title switch while playback is live", async () => {
    // `hold` keeps the fake mpv alive so the notifications overlay can open
    // over a genuinely-playing session — the direct-dispatch delivery target.
    await withSession(
      "wiring-inbox-play-direct",
      { mpv: "fake", fakeMpvMode: "hold" },
      async (s) => {
        await s.waitForFrame((f) => f.includes("Search title"), "browse shell");
        seedEpisodeNotification(s, {
          dedupKey: "wiring:smoke-anime-ep7",
          title: "Smoke Anime ep 7 available",
          body: "absolute episode 7 just landed",
          item: {
            mediaKind: "anime",
            titleId: "anilist:smoke-anime-1",
            title: "Smoke Anime",
            absoluteEpisode: 7,
          },
        });

        // Start live playback of the smoke movie — it holds instead of ending.
        s.press("movie", K.enter);
        await s.waitForFrame((f) => f.includes("Smoke Movie"), "fixture results");
        s.press(K.enter);
        await s.waitForFrame((f) => f.includes("Now Playing"), "playback live", 30_000);

        // Direct route: /history opens a root overlay over the live playback
        // mount; the overlay's own / palette then dispatches OPEN_OVERLAY with
        // no bridge awaiter, so the row must self-deliver a switch-title.
        s.press("/");
        await s.waitForFrame((f) => f.includes("command"), "command palette");
        s.press("history", K.enter);
        await s.waitForFrame((f) => f.includes("History"), "history overlay");
        await s.waitSettled();

        s.press("/");
        await s.waitForFrame((f) => f.includes("command"), "overlay command palette");
        s.press("notifications", K.enter);
        await s.waitForFrame((f) => f.includes("Smoke Anime ep 7"), "inbox row (direct)");
        await s.waitSettled();

        // Live playback gates play-now behind "Switch playback?" first.
        s.press(K.enter);
        await s.waitForFrame((f) => f.includes("Switch playback"), "switch confirmation");
        await s.waitSettled();
        s.press(K.enter);

        // Proof the announced title actually launched: the resolve/startup
        // diagnostics carry the title id — a frame claim alone would also
        // match the lingering inbox toast.
        await s.waitForBackend(
          (i) =>
            i
              .tableRows("cache.diagnostic_events")
              .some((row) => row.includes("anilist:smoke-anime-1")),
          "playback startup diagnostics for the announced anime title",
          30_000,
        );
      },
    );
  }, 60_000);
});

describe("agent wiring · offline mode", () => {
  it("offline mode parks on the library instead of starving the session loop", async () => {
    // Regression for the livelock: offlineMode + empty query used to return a
    // synchronous `cancelled` from SearchPhase, and SessionController retried
    // it on pure microtasks — CPU spin, SIGINT undeliverable, dispose() never
    // resolving (only SIGKILL stopped the process). On the buggy code this
    // test times out before the first frame; on the fix the library surface
    // mounts, Esc closes and re-parks it, and shutdown lands through the
    // parked wait.
    await withSession(
      "wiring-offline",
      { seed: { ...onboardedConfig(), offlineMode: true } },
      async (s) => {
        await s.waitForFrame((f) => f.includes("Library"), "offline library surface");

        s.press(K.esc);
        await s.waitSettled();
        await s.waitForFrame((f) => f.includes("Library"), "library re-parked after esc");

        s.press(K.ctrlC);
        await s.waitSettled();
        expect(s.quitRequested()).not.toBeNull();
      },
    );
  }, 30_000);
});

describe("agent wiring · playback failure", () => {
  it("an exhausted startup failover still lets the session shut down", async () => {
    // Regression for the abort-blind error wait: showPlaybackError parked on a
    // stateManager.subscribe predicate that only a user dismissal could
    // satisfy — context.signal was never wired in, so after failover exhausted
    // its budget the phase outlived the abort and dispose() timed out on run().
    // withSession's finally disposes the session: pre-fix that threw after the
    // stop deadline; on the fix the abort releases the wait and it settles.
    await withSession(
      "wiring-failover",
      { mpv: "fake", fakeMpvMode: "fail-pre-loaded" },
      async (s) => {
        await s.waitForFrame((f) => f.includes("Search title"), "browse shell");
        s.press("smoke", K.enter);
        await s.waitForFrame((f) => f.includes("Smoke Movie"), "fixture results");
        s.press(K.enter);
        // Assert the failure actually happened from the backend — the frame
        // text on the failure surface is presentation detail; the committed
        // diagnostics row is the truth. Failover hops + diagnostic writes can
        // exceed the 10s budget on a loaded CI runner — the assertion is the
        // wait, not the speed.
        await s.waitForBackend(
          (i) =>
            i.tableRows("cache.diagnostic_events").some((row) => /failover|exhausted/i.test(row)),
          "diagnostic_events records failover exhaustion",
          30_000,
        );
      },
    );
  }, 45_000);
});

describe("agent wiring · first-run Browse", () => {
  it("the field is live before the picks land, and a typed query searches", async () => {
    // The landing a never-onboarded install gets. Picks used to be awaited
    // before Browse mounted (no typing until the catalog answered) and then
    // took focus when they arrived, so "type a title, press Enter" opened a
    // recommendation. Whether the picks land before, during or after the
    // typing below is exactly the race this must survive, so the scenario
    // does not wait for them.
    await withSession(
      "wiring-first-browse",
      { seed: "fresh", bootstrap: { initialRoute: "recommendation" }, mpv: "fake" },
      async (s) => {
        await s.waitForFrame((f) => f.includes("Search title"), "browse shell");
        // Something to do is on screen with the field, not instead of it.
        expect(s.frames().some((f) => f.includes("Or start here"))).toBe(true);

        s.press("smoke", K.enter);
        await s.waitForFrame((f) => f.includes("Smoke Movie"), "fixture results");
        expect(s.frame()).toContain("2 results");
        // Backend witness: Enter searched. Nothing was resolved or played.
        expect(s.inspect().history()).toEqual([]);

        // The reverse case: Enter on the result list is what plays.
        s.press(K.enter);
        await s.waitForBackend(
          (i) => i.history().length > 0,
          "history records the title the user chose",
          30_000,
        );
        expect(s.inspect().history()[0]?.title_id).toBe("tmdb:smoke-movie-1");
      },
    );
  }, 60_000);
});
