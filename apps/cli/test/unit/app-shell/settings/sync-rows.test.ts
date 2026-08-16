import { describe, expect, test } from "bun:test";

import { syncSettingsRows } from "@/app-shell/settings/registry/sync";
import type { SettingsRegistryContext } from "@/app-shell/settings/types";
import type { SyncAuthAvailability } from "@/services/sync/auth-contract";
import type { SyncAdapter } from "@/services/sync/SyncAdapter";
import type { ConnectionState, SyncCapabilities, TrackerId } from "@/services/sync/types";
import { DEFAULT_CONFIG } from "@kunai/config";

const ANILIST_CAPS: SyncCapabilities = {
  episodeProgress: true,
  watchlistMembership: true,
  favoriteMembership: true,
  pullLists: false,
  rating: false,
};

const TMDB_CAPS: SyncCapabilities = { ...ANILIST_CAPS, episodeProgress: false };

function adapter(
  id: TrackerId,
  connection: ConnectionState,
  capabilities: SyncCapabilities,
): SyncAdapter {
  return {
    id,
    displayName: id === "anilist" ? "AniList" : "TMDB",
    capabilities,
    apply: async () => ({ status: "ok" }),
    isConnected: () => connection.state === "connected",
    getConnection: () => connection,
    refreshIdentity: async () => {},
    connect: async () => ({ ok: true }),
    disconnect: async () => {},
  };
}

const availableAuth: SyncAuthAvailability = {
  anilist: {
    available: true,
    redirectUri: "http://127.0.0.1:43863/callback",
    clientIdSource: "shipped-default",
  },
  tmdb: { available: true, apiKeySource: "shipped-fallback" },
};

function context(overrides: {
  adapters?: readonly SyncAdapter[];
  authAvailability?: SyncAuthAvailability;
  pausedUntil?: string | null;
  status?: { pending: number; needsReauth: number; connected: number };
}): SettingsRegistryContext {
  const status = overrides.status ?? { pending: 0, needsReauth: 0, connected: 1 };
  const config = {
    ...DEFAULT_CONFIG,
    sync: { ...DEFAULT_CONFIG.sync, pausedUntil: overrides.pausedUntil ?? null },
  };
  return {
    config,
    presenceSnapshot: null,
    seriesProviderOptions: [],
    animeProviderOptions: [],
    youtubeProviderOptions: [],
    sync: {
      adapters: overrides.adapters ?? [],
      authAvailability: overrides.authAvailability ?? availableAuth,
      status: { ...status, deadLettered: 0, health: "ok" as const },
    },
  } as unknown as SettingsRegistryContext;
}

const idsOf = (ctx: SettingsRegistryContext) => syncSettingsRows(ctx).map((row) => row.id);
const rowById = (ctx: SettingsRegistryContext, id: string) =>
  syncSettingsRows(ctx).find((row) => row.id === id);

describe("syncSettingsRows capability truth", () => {
  /**
   * TMDB v3 has no episode-progress endpoint. Offering the control anyway is
   * the house failure mode: a switch the user can flip that nothing reads.
   */
  test("does not offer episode progress for a tracker that cannot do it", () => {
    const tmdb = adapter("tmdb", { state: "connected" }, TMDB_CAPS);
    const row = rowById(context({ adapters: [tmdb] }), "sync:tmdb:trackWatched");

    expect(row?.kind).toBe("boolean");
    expect(row?.kind === "boolean" && row.gate?.predicate?.(DEFAULT_CONFIG)).toBe(false);
  });

  test("offers episode progress for a tracker that does", () => {
    const anilist = adapter("anilist", { state: "connected" }, ANILIST_CAPS);
    const row = rowById(context({ adapters: [anilist] }), "sync:anilist:trackWatched");

    expect(row?.kind === "boolean" && row.gate?.predicate?.(DEFAULT_CONFIG)).toBe(true);
  });

  test("describes each tracker by what it actually writes", () => {
    const rows = syncSettingsRows(
      context({
        adapters: [
          adapter("anilist", { state: "connected" }, ANILIST_CAPS),
          adapter("tmdb", { state: "connected" }, TMDB_CAPS),
        ],
      }),
    );

    const anilist = rows.find((row) => row.id === "sync:anilist:status");
    const tmdb = rows.find((row) => row.id === "sync:tmdb:status");

    expect(anilist?.detail).toContain("episode progress");
    expect(tmdb?.detail).not.toContain("episode progress");
    expect(tmdb?.detail).toContain("watchlist");
  });
});

describe("syncSettingsRows connection truth", () => {
  test("offers Connect when disconnected and Disconnect when connected", () => {
    const off = rowById(
      context({ adapters: [adapter("anilist", { state: "disconnected" }, ANILIST_CAPS)] }),
      "sync:anilist:connection",
    );
    const on = rowById(
      context({
        adapters: [adapter("anilist", { state: "connected", username: "kitsune" }, ANILIST_CAPS)],
      }),
      "sync:anilist:connection",
    );

    expect(off?.label).toBe("Connect AniList");
    expect(on?.label).toBe("Disconnect AniList");
  });

  /** A refused credential must not read as a healthy connection. */
  test("renders needs-reauth distinctly and still offers reconnection", () => {
    const ctx = context({
      adapters: [
        adapter("anilist", { state: "needs-reauth", reason: "token-rejected" }, ANILIST_CAPS),
      ],
    });

    expect(rowById(ctx, "sync:anilist:status")?.detail).toContain("sign-in expired");
    const anilistStatus = rowById(ctx, "sync:anilist:status");
    expect(anilistStatus?.kind === "status" && anilistStatus.tone).toBe("warning");
    expect(rowById(ctx, "sync:anilist:connection")?.label).toBe("Connect AniList");
  });

  test("shows the connected account name when there is one", () => {
    const ctx = context({
      adapters: [adapter("anilist", { state: "connected", username: "kitsune" }, ANILIST_CAPS)],
    });

    expect(rowById(ctx, "sync:anilist:status")?.detail).toContain("@kitsune");
  });

  /**
   * The only input to whether Connect is offerable is the resolved availability.
   * Settings must never re-derive it from the environment.
   */
  test("reports an unavailable tracker with its bounded reason", () => {
    const ctx = context({
      adapters: [adapter("anilist", { state: "disconnected" }, ANILIST_CAPS)],
      authAvailability: {
        ...availableAuth,
        anilist: { available: false, reason: "callback-missing" },
      },
    });

    expect(rowById(ctx, "sync:anilist:status")?.detail).toBe("unavailable: callback-missing");
    const anilistStatus = rowById(ctx, "sync:anilist:status");
    expect(anilistStatus?.kind === "status" && anilistStatus.tone).toBe("warning");
  });
});

describe("syncSettingsRows pause", () => {
  test("summarises an active pause and offers resuming", () => {
    const ctx = context({ pausedUntil: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });
    const row = rowById(ctx, "sync:pause");

    expect(row?.kind).toBe("submenu");
    expect(row?.kind === "submenu" && row.summarize(ctx.config)).toContain("paused for");
    const choices = row?.kind === "submenu" ? row.buildChoices(ctx) : [];
    expect(choices.map((choice) => choice.value)).toContain("resume");
  });

  test("resuming clears the pause and a preset sets one in the future", () => {
    const ctx = context({ pausedUntil: new Date(Date.now() + 3_600_000).toISOString() });
    const row = rowById(ctx, "sync:pause");
    if (row?.kind !== "submenu") throw new Error("expected a submenu row");

    const resumed = row.onPick(ctx.config, "resume", ctx);
    const config = "next" in resumed ? resumed.next : resumed;
    expect(config.sync.pausedUntil).toBeNull();

    const paused = row.onPick(ctx.config, "1h", ctx);
    const pausedConfig = "next" in paused ? paused.next : paused;
    expect(new Date(String(pausedConfig.sync.pausedUntil)).getTime()).toBeGreaterThan(Date.now());
  });

  /** Pausing must never read as data loss: the backlog stays visible. */
  test("keeps the queued count visible while paused", () => {
    const ctx = context({
      pausedUntil: new Date(Date.now() + 3_600_000).toISOString(),
      status: { pending: 8, needsReauth: 0, connected: 1 },
    });

    expect(rowById(ctx, "sync:status")?.detail).toContain("8 changes queued");
  });

  test("says what is queued when running normally", () => {
    const ctx = context({ status: { pending: 3, needsReauth: 0, connected: 1 } });
    expect(rowById(ctx, "sync:status")?.detail).toBe("3 changes queued");
  });

  test("prioritises a needed sign-in over the backlog", () => {
    const ctx = context({ status: { pending: 3, needsReauth: 1, connected: 1 } });
    expect(rowById(ctx, "sync:status")?.detail).toContain("needs signing in again");
  });
});

describe("syncSettingsRows hygiene", () => {
  /** Settings must decide from typed projections, never by peeking at the env. */
  test("the module reads no environment variable and no credential literal", async () => {
    const source = await Bun.file("src/app-shell/settings/registry/sync.ts").text();
    // Comments explain the rule and would otherwise trip it.
    const code = source
      .split("\n")
      .filter((line) => !/^\s*(?:\/\/|\/?\*)/.test(line))
      .join("\n");

    expect(code).not.toContain("process.env");
    expect(code).not.toContain("TMDB_API_KEY");
    expect(code).not.toContain("SHIPPED_ANILIST_CLIENT_ID");
  });

  test("every row id is unique", () => {
    const ids = idsOf(
      context({
        adapters: [
          adapter("anilist", { state: "connected" }, ANILIST_CAPS),
          adapter("tmdb", { state: "disconnected" }, TMDB_CAPS),
        ],
      }),
    );

    expect(new Set(ids).size).toBe(ids.length);
  });
});
