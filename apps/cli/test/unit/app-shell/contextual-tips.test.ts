import { afterEach, describe, expect, test } from "bun:test";

import {
  contextualTipCatalog,
  contextualTipLine,
  notePaletteCommand,
  setContextualTipListener,
} from "@/app-shell/contextual-tips";
import { KEYBINDINGS } from "@/app-shell/keybindings";
import { SEARCH_BROWSE_COMMAND_IDS } from "@/app-shell/search-browse-command-ids";
import { selectTransientRow } from "@/app-shell/transient-row";
import type { Container } from "@/container";
import { COMMAND_CONTEXTS, type AppCommandId } from "@/domain/session/command-registry";
import {
  CONTEXTUAL_TIPS,
  contextualTipEligible,
  contextualTipForCommand,
  type ContextualTipSurface,
} from "@/domain/session/contextual-tips";
import { SessionStateManagerImpl } from "@/domain/session/SessionStateManager";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { ConfigServiceImpl } from "@/services/persistence/ConfigServiceImpl";
import type { ConfigStore } from "@/services/persistence/ConfigStore";

class MemoryConfigStore implements ConfigStore {
  constructor(private loaded: Partial<KitsuneConfig> = {}) {}
  async load(): Promise<Partial<KitsuneConfig>> {
    return this.loaded;
  }
  async save(config: KitsuneConfig): Promise<void> {
    this.loaded = config;
  }
  async reset(): Promise<void> {
    this.loaded = {};
  }
}

/** Drains the microtask queue — update()→save() runs fire-and-forget. */
async function drainMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}

function createStateManager(): SessionStateManagerImpl {
  return new SessionStateManagerImpl({
    // SAFETY: stub logger — the state manager under test only calls these
    // four methods; the real Logger surface is larger.
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    } as never,
  });
}

async function createContainer(store: MemoryConfigStore): Promise<{
  container: Container;
  config: ConfigServiceImpl;
  stateManager: SessionStateManagerImpl;
}> {
  const config = await ConfigServiceImpl.load(store);
  const stateManager = createStateManager();
  return {
    // SAFETY: deliberately minimal container — the tips wiring reads only
    // config and stateManager from it.
    container: { config, stateManager } as never,
    config,
    stateManager,
  };
}

const PALETTE_LISTS = {
  browse: SEARCH_BROWSE_COMMAND_IDS,
  activePlayback: COMMAND_CONTEXTS.activePlayback,
  postPlayback: COMMAND_CONTEXTS.postPlayback,
} satisfies Record<ContextualTipSurface, readonly string[]>;

describe("the tip map", () => {
  test("every tip's command is actually pickable on every surface it declares", () => {
    // A tip for a command the palette does not offer can never fire — dead
    // copy. This is the check that keeps the map honest as palettes change.
    for (const tip of CONTEXTUAL_TIPS) {
      for (const surface of tip.surfaces) {
        // SAFETY: the satisfies'd list values widen to their element unions;
        // reading them back as AppCommandId rows is the same contract the
        // annotation previously declared.
        expect(
          (PALETTE_LISTS[surface] as readonly AppCommandId[]).includes(tip.commandId),
          `${tip.id}: ${tip.commandId} not in the ${surface} palette`,
        ).toBe(true);
      }
    }
  });

  test("every taught binding resolves to a real keybinding entry", () => {
    for (const tip of CONTEXTUAL_TIPS) {
      if (tip.bindingId === undefined) continue;
      expect(
        KEYBINDINGS.some((binding) => binding.id === tip.bindingId),
        `${tip.id}: missing binding ${tip.bindingId}`,
      ).toBe(true);
    }
  });

  test("maps a palette pick to its lesson only on the surface where the key lives", () => {
    expect(contextualTipForCommand("up-next", "browse")?.id).toBe("tip-up-next-key");
    expect(contextualTipForCommand("toggle-mode", "browse")?.id).toBe("tip-mode-tab");
    expect(contextualTipForCommand("search", "postPlayback")?.id).toBe("tip-search-post-key");
    expect(contextualTipForCommand("history", "postPlayback")?.id).toBe("tip-history-post-key");
    // `n` is two different lessons on two surfaces.
    expect(contextualTipForCommand("next", "activePlayback")?.id).toBe("tip-next-key");
    expect(contextualTipForCommand("next", "postPlayback")?.id).toBe("tip-post-continue-key");
    // `?` is live everywhere a tip can fire.
    expect(contextualTipForCommand("help", "browse")?.id).toBe("tip-help-key");
    expect(contextualTipForCommand("help", "activePlayback")?.id).toBe("tip-help-key");
    expect(contextualTipForCommand("help", "postPlayback")?.id).toBe("tip-help-key");
  });

  test("teaches nothing for commands picked where the key is not live", () => {
    // ⇧Q, ⇧N, and Tab are browse bindings; the same commands picked from a
    // playback or post-play palette would teach a chord that does nothing.
    expect(contextualTipForCommand("up-next", "activePlayback")).toBeNull();
    expect(contextualTipForCommand("up-next", "postPlayback")).toBeNull();
    expect(contextualTipForCommand("notifications", "postPlayback")).toBeNull();
    expect(contextualTipForCommand("toggle-mode", "postPlayback")).toBeNull();
    // `s` only searches post-play — on browse, typing IS the search.
    expect(contextualTipForCommand("search", "browse")).toBeNull();
    // No browse binding opens history; only post-play's `h` exists.
    expect(contextualTipForCommand("history", "browse")).toBeNull();
    // Untipped commands teach nothing anywhere.
    expect(contextualTipForCommand("settings", "browse")).toBeNull();
    expect(contextualTipForCommand("watch", "browse")).toBeNull();
  });
});

describe("tip eligibility", () => {
  const tip = CONTEXTUAL_TIPS[0]!;
  const open = { tipsEnabled: true, seenTips: [], overlayOpen: false };

  test("fires for a fresh user on a clear surface", () => {
    expect(contextualTipEligible(tip, open)).toBe(true);
  });

  test("never fires a second time once the id is seen", () => {
    expect(contextualTipEligible(tip, { ...open, seenTips: [tip.id] })).toBe(false);
  });

  test("respects the settings opt-out", () => {
    expect(contextualTipEligible(tip, { ...open, tipsEnabled: false })).toBe(false);
  });

  test("never fires while an overlay or picker owns focus", () => {
    expect(contextualTipEligible(tip, { ...open, overlayOpen: true })).toBe(false);
  });
});

describe("tip copy", () => {
  test("renders the real chord, so copy can never drift from the binding", () => {
    const upNext = contextualTipForCommand("up-next", "browse")!;
    expect(contextualTipLine(upNext)).toBe("tip: ⇧Q opens up next");

    const help = contextualTipForCommand("help", "browse")!;
    expect(contextualTipLine(help)).toBe("tip: ? opens help");

    const next = contextualTipForCommand("next", "activePlayback")!;
    expect(contextualTipLine(next)).toBe("tip: n / N goes to the next episode");
  });

  test("a binding id that no longer exists renders nothing, not a dangling tip:", () => {
    const ghost = { ...CONTEXTUAL_TIPS[0]!, bindingId: "binding-that-was-renamed" };
    expect(contextualTipLine(ghost)).toBeNull();
  });
});

describe("notePaletteCommand", () => {
  afterEach(() => {
    setContextualTipListener(null);
  });

  test("emits the line once and persists the seen id across a restart", async () => {
    const store = new MemoryConfigStore();
    const { container, config } = await createContainer(store);
    const lines: string[] = [];
    setContextualTipListener((line) => lines.push(line));

    notePaletteCommand(container, "browse", "up-next");
    await drainMicrotasks();
    await config.flushPending();

    expect(lines).toEqual(["tip: ⇧Q opens up next"]);
    expect(config.seenTips).toEqual(["tip-up-next-key"]);

    // Second pick on the same service: already seen, stays silent.
    notePaletteCommand(container, "browse", "up-next");
    await drainMicrotasks();
    expect(lines).toHaveLength(1);

    // Restart: a fresh ConfigService over the same store still knows.
    const reloaded = await ConfigServiceImpl.load(store);
    const restarted = {
      // SAFETY: deliberately minimal container — same as above.
      container: { config: reloaded, stateManager: createStateManager() } as never,
    };
    notePaletteCommand(restarted.container, "browse", "up-next");
    await drainMicrotasks();
    expect(lines).toHaveLength(1);
    expect(reloaded.seenTips).toEqual(["tip-up-next-key"]);
  });

  test("a different unseen command still teaches after the first", async () => {
    const { container } = await createContainer(new MemoryConfigStore());
    const lines: string[] = [];
    setContextualTipListener((line) => lines.push(line));

    notePaletteCommand(container, "browse", "up-next");
    notePaletteCommand(container, "browse", "toggle-mode");
    await drainMicrotasks();

    expect(lines).toEqual(["tip: ⇧Q opens up next", "tip: Tab / ⇧Tab cycles catalog mode"]);
  });

  test("stays silent when the user disabled tips", async () => {
    const store = new MemoryConfigStore({ tipsEnabled: false });
    const { container, config } = await createContainer(store);
    const lines: string[] = [];
    setContextualTipListener((line) => lines.push(line));

    notePaletteCommand(container, "browse", "up-next");
    await drainMicrotasks();

    expect(lines).toEqual([]);
    // Disabled must not burn the tip either — re-enabling should still teach.
    expect(config.seenTips).toEqual([]);
  });

  test("stays silent while an overlay or picker owns focus", async () => {
    const { container, config, stateManager } = await createContainer(new MemoryConfigStore());
    const lines: string[] = [];
    setContextualTipListener((line) => lines.push(line));

    stateManager.dispatch({ type: "OPEN_OVERLAY", overlay: { type: "settings" } });
    notePaletteCommand(container, "browse", "up-next");
    await drainMicrotasks();

    expect(lines).toEqual([]);
    // Suppressed ≠ consumed: once the overlay closes the tip may still teach.
    expect(config.seenTips).toEqual([]);

    stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
    notePaletteCommand(container, "browse", "up-next");
    await drainMicrotasks();
    expect(lines).toEqual(["tip: ⇧Q opens up next"]);
  });

  test("does nothing for commands with no lesson on this surface", async () => {
    const { container, config } = await createContainer(new MemoryConfigStore());
    const lines: string[] = [];
    setContextualTipListener((line) => lines.push(line));

    // SAFETY: string literal asserted as AppCommandId — the test deliberately
    // feeds an id outside the picker lists to exercise the boundary.
    notePaletteCommand(container, "postPlayback", "up-next" as AppCommandId);
    // SAFETY: string literal asserted as AppCommandId — the test deliberately
    // feeds an id outside the picker lists to exercise the boundary.
    notePaletteCommand(container, "browse", "settings" as AppCommandId);
    await drainMicrotasks();

    expect(lines).toEqual([]);
    expect(config.seenTips).toEqual([]);
  });
});

describe("the tips catalog", () => {
  test("lists every tip with its rendered line and seen state", () => {
    const catalog = contextualTipCatalog(["tip-up-next-key"]);
    expect(catalog.length).toBe(CONTEXTUAL_TIPS.length);
    const upNext = catalog.find((entry) => entry.id === "tip-up-next-key");
    expect(upNext?.seen).toBe(true);
    expect(upNext?.line).toBe("tip: ⇧Q opens up next");
    const unseen = catalog.find((entry) => entry.id === "tip-help-key");
    expect(unseen?.seen).toBe(false);
  });
});

describe("the transient row", () => {
  const base = {
    alert: null,
    notificationToast: null,
    streakMilestoneAlert: null,
    presenceBootLine: null,
    streakAtRiskAlert: null,
    weeklyDigestLine: null,
    tipLine: "tip: ⇧Q opens up next",
  };

  test("shows the tip when nothing louder is pending", () => {
    expect(selectTransientRow(base)?.text).toBe("tip: ⇧Q opens up next");
    expect(selectTransientRow(base)?.dim).toBe(true);
  });

  test("yields to every real status line", () => {
    expect(
      selectTransientRow({ ...base, alert: { text: "connection lost", tone: "error" } })?.text,
    ).toBe("connection lost");
    expect(selectTransientRow({ ...base, notificationToast: "download finished" })?.text).toBe(
      "download finished",
    );
    expect(selectTransientRow({ ...base, streakMilestoneAlert: "3-day streak" })?.text).toBe(
      "3-day streak",
    );
    expect(
      selectTransientRow({ ...base, presenceBootLine: { text: "friends online", tone: "info" } })
        ?.text,
    ).toBe("friends online");
    expect(selectTransientRow({ ...base, streakAtRiskAlert: "streak at risk" })?.text).toBe(
      "streak at risk",
    );
    expect(selectTransientRow({ ...base, weeklyDigestLine: "your week" })?.text).toBe("your week");
  });
});
