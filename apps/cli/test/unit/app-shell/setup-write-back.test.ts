import { describe, expect, test } from "bun:test";

import { forceCloseRootContent } from "@/app-shell/root-content-state";
import type { SetupFlowPayload } from "@/app-shell/setup-shell";
import {
  runSetupWizard,
  wizardInitialStateFromConfig,
} from "@/app-shell/workflows/setup-workflows";
import type { Container } from "@/container";
import { DEFAULT_CONFIG } from "@kunai/config";

type FakeAdapter = {
  id: "anilist" | "tmdb";
  displayName: string;
  state: "connected" | "disconnected" | "needs-reauth";
  connectResult: { ok: true } | { ok: false; error: string };
  connectCalls: number;
};

function fakeContainer(
  configOverrides: Record<string, unknown> = {},
  adapterDefs: FakeAdapter[] = [],
) {
  const config = {
    ...DEFAULT_CONFIG,
    installId: "",
    ...configOverrides,
  };
  const notes: string[] = [];
  const diagnostics: string[] = [];
  const adapters = adapterDefs.map((def) => ({ ...def, connectCalls: 0 }));
  const container = {
    config: {
      getRaw: () => config,
      update: async (patch: Partial<typeof config>) => {
        Object.assign(config, patch);
      },
      save: async () => undefined,
    },
    capabilitySnapshot: {
      mpv: true,
      ffprobe: true,
      ytDlp: true,
      curl: { present: true, impersonates: true, profile: "chrome150" },
      image: {
        terminal: "unknown",
        protocol: "none",
        renderer: "none",
        available: false,
        reason: "test fixture",
      },
      issues: [],
    },
    usageAnalytics: {
      consentPatch: (choice: "enabled" | "disabled") =>
        choice === "enabled"
          ? { analytics: "enabled" as const, installId: config.installId }
          : { analytics: "disabled" as const, installId: "" },
    },
    diagnosticsService: {
      record: (entry: { message: string }) => diagnostics.push(entry.message),
    },
    stateManager: {
      dispatch: (action: { type: string; note?: string }) => {
        if (action.type === "SET_PLAYBACK_FEEDBACK" && action.note) notes.push(action.note);
      },
      getState: () => ({ activeModals: [] as unknown[] }),
    },
    syncService: {
      adapters: adapters.map((a) => ({
        id: a.id,
        displayName: a.displayName,
        getConnection: () => ({ state: a.state }),
        connect: async () => {
          a.connectCalls += 1;
          return a.connectResult;
        },
      })),
      resumeAfterReauth: () => 0,
      deliverSoon: () => undefined,
    },
    analyticsDisclosurePending: false,
  } as unknown as Container;
  return { container, config, notes, diagnostics, adapters };
}

const BASE_PREFS: SetupFlowPayload["prefs"] = {
  mode: "series",
  audio: "original",
  subtitle: "en",
  autoNext: true,
  skipIntro: true,
  skipCredits: true,
  downloadsEnabled: false,
  downloadQuality: "1080p",
  connectAniList: false,
  connectTmdb: false,
  presenceDiscord: false,
  analyticsChoice: "unchanged",
};

function payload(
  overrides: {
    readonly outcome?: SetupFlowPayload["outcome"];
    readonly answeredScreens?: number;
    readonly prefs?: Partial<SetupFlowPayload["prefs"]>;
  } = {},
): SetupFlowPayload {
  const { outcome = "completed", answeredScreens = 6, prefs = {} } = overrides;
  return { outcome, answeredScreens, prefs: { ...BASE_PREFS, ...prefs } };
}

test("the language choice reaches all four lanes, including YouTube (#229)", async () => {
  const { container, config } = fakeContainer();

  const pending = runSetupWizard({ container, force: true });
  expect(forceCloseRootContent(payload({ prefs: { audio: "ja", subtitle: "es" } }))).toBe(true);
  await pending;

  for (const lane of [
    "animeLanguageProfile",
    "seriesLanguageProfile",
    "movieLanguageProfile",
    "youtubeLanguageProfile",
  ] as const) {
    expect(config[lane].audio).toBe("ja");
    expect(config[lane].subtitle).toBe("es");
  }
});

test("a rerun over linked trackers keeps them enabled without re-auth (#228, #232)", async () => {
  const { container, config, adapters } = fakeContainer(
    {
      sync: { ...DEFAULT_CONFIG.sync, anilist: { ...DEFAULT_CONFIG.sync.anilist, enabled: true } },
    },
    [
      {
        id: "anilist",
        displayName: "AniList",
        state: "connected",
        connectResult: { ok: true },
        connectCalls: 0,
      },
    ],
  );
  const [anilist] = adapters;

  const pending = runSetupWizard({ container, force: true });
  // The toggle hydrated ON and was left alone; completing must not flip it off.
  expect(forceCloseRootContent(payload({ prefs: { connectAniList: true } }))).toBe(true);
  await pending;

  expect(config.sync.anilist.enabled).toBe(true);
  // Already connected: no second OAuth round-trip.
  expect(anilist?.connectCalls).toBe(0);
});

test("an explicit turn-off commits enabled:false even while connected (#228)", async () => {
  const { container, config } = fakeContainer(
    {
      sync: { ...DEFAULT_CONFIG.sync, anilist: { ...DEFAULT_CONFIG.sync.anilist, enabled: true } },
    },
    [
      {
        id: "anilist",
        displayName: "AniList",
        state: "connected",
        connectResult: { ok: true },
        connectCalls: 0,
      },
    ],
  );

  const pending = runSetupWizard({ container, force: true });
  expect(forceCloseRootContent(payload({}))).toBe(true); // toggle left OFF deliberately
  await pending;

  expect(config.sync.anilist.enabled).toBe(false);
});

test("a failed browser handoff does not flip the standing decision on (#232)", async () => {
  const { container, config, adapters, diagnostics, notes } = fakeContainer({}, [
    {
      id: "anilist",
      displayName: "AniList",
      state: "disconnected",
      connectResult: { ok: false, error: "browser never opened" },
      connectCalls: 0,
    },
  ]);
  const [anilist] = adapters;

  const pending = runSetupWizard({ container, force: true });
  expect(forceCloseRootContent(payload({ prefs: { connectAniList: true } }))).toBe(true);
  await pending;

  expect(anilist?.connectCalls).toBe(1);
  expect(config.sync.anilist.enabled).toBe(false);
  expect(diagnostics.some((m) => m.includes("linking anilist"))).toBe(true);
  expect(notes.some((n) => n.includes("/sync-connect-anilist"))).toBe(true);
});

test("a successful handoff flips enabled on after the fact (#232)", async () => {
  const { container, config, adapters } = fakeContainer({}, [
    {
      id: "tmdb",
      displayName: "TMDB",
      state: "disconnected",
      connectResult: { ok: true },
      connectCalls: 0,
    },
  ]);
  const [tmdb] = adapters;

  const pending = runSetupWizard({ container, force: true });
  expect(forceCloseRootContent(payload({ prefs: { connectTmdb: true } }))).toBe(true);
  await pending;

  expect(tmdb?.connectCalls).toBe(1);
  expect(config.sync.tmdb.enabled).toBe(true);
  expect(config.sync.anilist.enabled).toBe(false);
});

test("aborting never opens a browser, whatever the toggles said (#232)", async () => {
  // OAuth is outward-facing, so it answers to the same rule analytics does: a
  // path the user bailed out of may not act on their behalf.
  const { container, config, adapters } = fakeContainer({}, [
    {
      id: "anilist",
      displayName: "AniList",
      state: "disconnected",
      connectResult: { ok: true },
      connectCalls: 0,
    },
  ]);
  const [anilist] = adapters;

  const pending = runSetupWizard({ container, force: true });
  expect(
    forceCloseRootContent(
      payload({
        outcome: "aborted",
        answeredScreens: 5,
        prefs: { connectAniList: true, presenceDiscord: true },
      }),
    ),
  ).toBe(true);
  await pending;

  expect(anilist?.connectCalls).toBe(0);
  expect(config.sync.anilist.enabled).toBe(false);
  expect(config.presenceProvider).toBe(DEFAULT_CONFIG.presenceProvider);
});

test("aborting untouched leaves the onboarding gate alone so setup is offered again (#230)", async () => {
  const { container, config, notes } = fakeContainer();

  const pending = runSetupWizard({ container, force: true });
  expect(forceCloseRootContent(payload({ outcome: "aborted", answeredScreens: 0 }))).toBe(true);
  await pending;

  expect(config.onboardingVersion).toBe(DEFAULT_CONFIG.onboardingVersion);
  expect(notes.some((n) => n.includes("/setup"))).toBe(true);
});

test("aborting after answering records the offer exactly once and nothing else (#230)", async () => {
  const { container, config } = fakeContainer();
  const before = JSON.stringify(config);

  const pending = runSetupWizard({ container, force: true });
  expect(forceCloseRootContent(payload({ outcome: "aborted", answeredScreens: 4 }))).toBe(true);
  await pending;

  expect(config.onboardingVersion).toBe(3);
  expect(config.downloadOnboardingDismissed).toBe(true);
  const after = { ...config };
  delete (after as Record<string, unknown>).onboardingVersion;
  delete (after as Record<string, unknown>).downloadOnboardingDismissed;
  const beforeSans = JSON.parse(before);
  delete beforeSans.onboardingVersion;
  delete beforeSans.downloadOnboardingDismissed;
  expect(JSON.stringify(after)).toBe(JSON.stringify(beforeSans));
});

describe("wizardInitialStateFromConfig", () => {
  test("hydrates every control from current config", () => {
    const initial = wizardInitialStateFromConfig(
      {
        ...DEFAULT_CONFIG,
        defaultMode: "anime",
        animeLanguageProfile: { audio: "en", subtitle: "none", quality: "best" },
        autoNext: false,
        skipIntro: false,
        skipCredits: false,
        downloadsEnabled: true,
        defaultDownloadQuality: "720p",
        sync: { ...DEFAULT_CONFIG.sync, tmdb: { ...DEFAULT_CONFIG.sync.tmdb, enabled: true } },
        presenceProvider: "discord",
      },
      true,
    );
    expect(initial).toEqual({
      mode: "anime",
      audio: "en",
      subtitle: "none",
      autoNext: false,
      skipIntro: false,
      skipCredits: false,
      downloadsEnabled: true,
      downloadQuality: "720p",
      anilistSync: false,
      tmdbSync: true,
      presenceDiscord: true,
    });
  });

  test("clamps a saved downloads preference to what is installed", () => {
    const base = wizardInitialStateFromConfig(DEFAULT_CONFIG, false);
    expect(base.downloadsEnabled).toBe(false);
    const withYtDlp = wizardInitialStateFromConfig(
      { ...DEFAULT_CONFIG, downloadsEnabled: true },
      true,
    );
    expect(withYtDlp.downloadsEnabled).toBe(true);
  });
});
