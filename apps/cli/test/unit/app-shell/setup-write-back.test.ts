import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  forceCloseRootContent,
  getRootContentSession,
  subscribeRootContentSession,
} from "@/app-shell/root-content-state";
import { FACTORY_INITIAL_STATE, type SetupFlowPayload } from "@/app-shell/setup-shell";
import {
  runSetupWizard,
  wizardInitialStateFromConfig,
} from "@/app-shell/workflows/setup-workflows";
import type { Container } from "@/container";
import {
  preSetupSnapshotPath,
  readPreSetupSnapshot,
  setupPatchIsRestorable,
} from "@/services/persistence/pre-setup-snapshot";
import { getKunaiPaths } from "@/services/storage/storage-read-models";
import { DEFAULT_CONFIG } from "@kunai/config";
import { act } from "react";

import { render } from "../../harness/render-capture";
import { applyStorageRootEnv } from "../../helpers/storage-env";

// `runSetupWizard` now writes a real restore point beside the real config, so
// every test in this file has to own its storage root or it would leave a
// `.pre-setup.bak` in the developer's actual profile.
let storageRoot = "";
let restoreEnv: () => void = () => undefined;

beforeAll(() => {
  storageRoot = mkdtempSync(join(tmpdir(), "kunai-setup-writeback-"));
  restoreEnv = applyStorageRootEnv(storageRoot);
  // Resolve the config directory rather than assuming the Linux layout — the
  // same env swap lands somewhere different on macOS and Windows.
  mkdirSync(getKunaiPaths().configDir, { recursive: true });
});

afterAll(() => {
  restoreEnv();
  rmSync(storageRoot, { recursive: true, force: true });
});

function clearSnapshot(): void {
  rmSync(preSetupSnapshotPath(), { recursive: true, force: true });
}

async function renderTrackerConnectSurface() {
  const waitForSession = () =>
    new Promise<NonNullable<ReturnType<typeof getRootContentSession>>>((resolve) => {
      const inspect = () => {
        const session = getRootContentSession();
        if (!session?.headerLabel?.startsWith("Connect ")) return;
        unsubscribe();
        resolve(session);
      };
      const unsubscribe = subscribeRootContentSession(inspect);
      inspect();
    });

  const session = await waitForSession();
  const handle = render(session.element, { columns: 100, rows: 32 });
  await act(async () => {
    for (let flush = 0; flush < 4; flush += 1) await Promise.resolve();
  });
  return handle;
}

/**
 * The wizard's write map, driven end to end through the real `runSetupWizard`.
 *
 * Structural guards live in `setup-write-map.test.ts`; these assert what
 * actually lands in config — the layer where a silent no-op (or worse, a
 * silent severance, #228) becomes real damage.
 */

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
  languageProfiles: FACTORY_INITIAL_STATE.languageProfiles,
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

function allLanguageProfiles(audio: string, subtitle: string) {
  return {
    series: { audio, subtitle },
    movie: { audio, subtitle },
    anime: { audio, subtitle },
    youtube: { audio, subtitle },
  };
}

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
  expect(
    forceCloseRootContent(
      payload({ prefs: { languageProfiles: allLanguageProfiles("ja", "es") } }),
    ),
  ).toBe(true);
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
  const connectSurface = await renderTrackerConnectSurface();
  expect(connectSurface.lastFrame()).toContain("browser never opened");
  connectSurface.stdin.enqueue("q");
  connectSurface.unmount();
  await pending;

  expect(anilist?.connectCalls).toBe(1);
  expect(config.sync.anilist.enabled).toBe(false);
  expect(diagnostics.some((m) => m.includes("linking anilist"))).toBe(true);
  expect(notes.some((n) => n.includes("browser never opened"))).toBe(true);
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
  const connectSurface = await renderTrackerConnectSurface();
  connectSurface.unmount();
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
        seriesLanguageProfile: { audio: "original", subtitle: "en", quality: "best" },
        movieLanguageProfile: { audio: "ja", subtitle: "es", quality: "best" },
        youtubeLanguageProfile: { audio: "en", subtitle: "interactive", quality: "best" },
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
      languageProfiles: {
        series: { audio: "original", subtitle: "en" },
        movie: { audio: "ja", subtitle: "es" },
        anime: { audio: "en", subtitle: "none" },
        youtube: { audio: "en", subtitle: "interactive" },
      },
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

// ─── Pre-setup restore point ──────────────────────────────────────────────────

/** A configuration whose four language lanes already agree. */
const SETTLED_CONFIG = {
  seriesLanguageProfile: { ...DEFAULT_CONFIG.seriesLanguageProfile, subtitle: "en" },
};

/** Prefs that re-answer `SETTLED_CONFIG` with exactly what it already holds. */
const SETTLED_PREFS = {
  mode: "series",
  languageProfiles: allLanguageProfiles("original", "en"),
  downloadQuality: "best",
} as const;

describe("pre-setup restore point", () => {
  test("a run that changes something worth keeping writes one snapshot", async () => {
    clearSnapshot();
    const { container, config, notes } = fakeContainer();

    const pending = runSetupWizard({ container, force: true });
    expect(
      forceCloseRootContent(
        payload({ prefs: { languageProfiles: allLanguageProfiles("ja", "es") } }),
      ),
    ).toBe(true);
    await pending;

    const snapshot = await readPreSetupSnapshot();
    expect(snapshot).not.toBeNull();
    // Taken BEFORE the write: it holds the old lanes, not the new ones.
    expect(snapshot?.animeLanguageProfile?.audio).toBe(DEFAULT_CONFIG.animeLanguageProfile.audio);
    expect(config.animeLanguageProfile.audio).toBe("ja");
    // A restore point nobody is told about is not a feature.
    expect(notes.some((n) => n.includes("/settings"))).toBe(true);
  });

  test("a run whose patch changes nothing takes no snapshot", async () => {
    clearSnapshot();
    const { container, notes } = fakeContainer(SETTLED_CONFIG);

    const pending = runSetupWizard({ container, force: true });
    expect(forceCloseRootContent(payload({ prefs: SETTLED_PREFS }))).toBe(true);
    await pending;

    expect(await readPreSetupSnapshot()).toBeNull();
    expect(notes.some((n) => n.includes("previous settings"))).toBe(false);
  });

  test("an analytics-only decision takes no snapshot", async () => {
    // Consent has its own screen, its own `/settings` switch, and its own
    // contract. It is not the kind of change anyone needs rescuing from.
    clearSnapshot();
    const { container, config } = fakeContainer(SETTLED_CONFIG);

    const pending = runSetupWizard({ container, force: true });
    expect(
      forceCloseRootContent(payload({ prefs: { ...SETTLED_PREFS, analyticsChoice: "enabled" } })),
    ).toBe(true);
    await pending;

    expect(config.analytics).toBe("enabled");
    expect(await readPreSetupSnapshot()).toBeNull();
  });

  test("an abort with nothing answered takes no snapshot", async () => {
    clearSnapshot();
    const { container } = fakeContainer();

    const pending = runSetupWizard({ container, force: true });
    expect(forceCloseRootContent(payload({ outcome: "aborted", answeredScreens: 0 }))).toBe(true);
    await pending;

    expect(await readPreSetupSnapshot()).toBeNull();
  });

  test("a snapshot that cannot be written still lets setup complete", async () => {
    clearSnapshot();
    // A directory where the file goes: the atomic rename cannot land, which is
    // the same shape as a read-only config dir or a full disk.
    mkdirSync(preSetupSnapshotPath(), { recursive: true });
    const { container, config, diagnostics } = fakeContainer();

    const pending = runSetupWizard({ container, force: true });
    expect(
      forceCloseRootContent(
        payload({ prefs: { languageProfiles: allLanguageProfiles("ja", "en") } }),
      ),
    ).toBe(true);
    await expect(pending).resolves.toBe("completed");

    expect(config.animeLanguageProfile.audio).toBe("ja");
    expect(diagnostics.some((m) => m.includes("snapshot"))).toBe(true);
    clearSnapshot();
  });

  test("the snapshot round-trips the pre-run configuration exactly", async () => {
    clearSnapshot();
    const { container, config } = fakeContainer({
      sync: { ...DEFAULT_CONFIG.sync, tmdb: { ...DEFAULT_CONFIG.sync.tmdb, enabled: true } },
    });
    const before = JSON.parse(JSON.stringify(config));

    const pending = runSetupWizard({ container, force: true });
    expect(
      forceCloseRootContent(
        payload({ prefs: { languageProfiles: allLanguageProfiles("ja", "es") } }),
      ),
    ).toBe(true);
    await pending;

    expect(JSON.parse(await readFile(preSetupSnapshotPath(), "utf8"))).toEqual(before);
    // And it is one file, not a history: a second run overwrites it in place.
    expect(await readPreSetupSnapshot()).toEqual(before);
  });
});

describe("setupPatchIsRestorable", () => {
  test("tracks the settings a user would miss and ignores the bookkeeping", () => {
    expect(setupPatchIsRestorable(DEFAULT_CONFIG, {})).toBe(false);
    expect(
      setupPatchIsRestorable(DEFAULT_CONFIG, {
        onboardingVersion: 99,
        downloadOnboardingDismissed: true,
      }),
    ).toBe(false);
    expect(setupPatchIsRestorable(DEFAULT_CONFIG, { analytics: "enabled", installId: "x" })).toBe(
      false,
    );
    expect(
      setupPatchIsRestorable(DEFAULT_CONFIG, {
        defaultMode: DEFAULT_CONFIG.defaultMode,
      }),
    ).toBe(false);
    expect(setupPatchIsRestorable(DEFAULT_CONFIG, { defaultMode: "anime" })).toBe(true);
    expect(
      setupPatchIsRestorable(DEFAULT_CONFIG, {
        sync: {
          ...DEFAULT_CONFIG.sync,
          anilist: { ...DEFAULT_CONFIG.sync.anilist, enabled: true },
        },
      }),
    ).toBe(true);
  });
});
