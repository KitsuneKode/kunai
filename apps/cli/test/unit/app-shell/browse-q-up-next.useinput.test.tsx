import { afterEach, describe, expect, test } from "bun:test";

import { BrowseShell } from "@/app-shell/browse-shell";
import { RootOverlayShell } from "@/app-shell/root-overlay-shell";
import type { BrowseShellOption, ShellAction } from "@/app-shell/types";
import { createInitialState } from "@/domain/session/SessionState";
import type { SearchResult } from "@/domain/types";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";
import React from "react";

import { render, stripAnsi } from "../../harness/render-capture";
import { createContainerFixture } from "../../support/container-fixture";
import { waitUntil } from "../../support/wait-until";

const LANGUAGE_PROFILES = {
  anime: { audio: "original", subtitle: "en" },
  series: { audio: "original", subtitle: "none" },
  movie: { audio: "original", subtitle: "en" },
} as const;

const PROVIDER_METADATA = {
  id: "videasy",
  name: "Videasy",
  description: "Series provider",
  isAnimeProvider: false,
  isYoutubeProvider: false,
  providerLane: "series",
} as const;

function trendingOption(label: string): BrowseShellOption<SearchResult> {
  return {
    label,
    value: {
      id: label,
      type: "series",
      title: label,
      year: "2026",
      overview: "",
      posterPath: null,
    },
  };
}

function renderBrowse(input: {
  readonly queued: SearchResult[];
  readonly initialResults?: readonly BrowseShellOption<SearchResult>[];
  readonly onCancel?: () => void;
}) {
  const resolved: Array<{ action: ShellAction; value?: SearchResult }> = [];
  const handle = render(
    <BrowseShell
      mode="series"
      provider="vidking"
      initialResults={input.initialResults}
      initialResultSubtitle={
        input.initialResults && input.initialResults.length > 0 ? "1 trending" : undefined
      }
      placeholder="Search"
      commands={[]}
      onSearch={async () => ({ options: [], subtitle: "", emptyMessage: "" })}
      onResolve={(action, value) => resolved.push({ action, value })}
      onSubmit={() => {}}
      onCancel={input.onCancel ?? (() => {})}
      onQueueSelected={(value) => {
        input.queued.push(value);
      }}
    />,
    { columns: 120, rows: 30 },
  );
  return { handle, resolved };
}

function rootOverlayContainer() {
  const fixture = createContainerFixture();
  Object.assign(fixture.container, {
    config: {
      getRaw: () => ({ ...DEFAULT_CONFIG, provider: "videasy", providerPriority: ["videasy"] }),
      update: async () => undefined,
      save: async () => undefined,
    },
    providerRegistry: {
      getAll: () => [{ metadata: PROVIDER_METADATA }],
      get: () => ({ metadata: PROVIDER_METADATA }),
    },
    providerHealth: { get: () => undefined },
    notificationService: {
      subscribe: () => () => undefined,
      getRevision: () => 0,
      listAllActive: () => [],
      listAllArchived: () => [],
      countUnread: () => 0,
    },
    diagnosticsService: {
      subscribe: () => () => undefined,
      getRevision: () => 0,
    },
    queueService: {
      getAll: () => [],
      getQueuedEpisodeKeys: () => new Set<string>(),
      getStatus: () => ({ isStale: false, unplayedCount: 0, nextItem: null, lastActivityAt: null }),
      listRecoverableSessions: () => [],
    },
    historyRepository: {
      listLatestByTitle: () => [],
      getLatestForTitle: () => undefined,
    },
    followedTitleRepository: { listByPreference: () => [] },
    listRepository: { getLists: () => [], getItems: () => [] },
    playlistsRepository: { list: () => [], listItems: () => [] },
    releaseProgressCache: { getByTitleIds: () => new Map() },
    historyCatalogEpisodeCounts: new Map<string, number>(),
    offlineTitlePolicies: { get: () => undefined },
    offlineAssetService: { listNextReadyByTitleCursors: () => [] },
    continueWatchingService: { titleDecision: () => undefined },
    featureFlags: {
      attentionInbox: false,
      queueRecovery: false,
      playlistSharing: false,
      newEpisodeProjection: false,
      providerAvailabilitySync: false,
    },
    capabilitySnapshot: {
      mpv: true,
      mpvRequired: true,
      ffprobe: false,
      ytDlp: false,
      discordRpc: false,
      sqlite: true,
      notifySend: false,
    },
    sessionUndo: undefined,
  });
  // SAFETY: RootOverlayShell reads the full session snapshot; the mock only types activeModals.
  fixture.stateManager.getState = () =>
    ({
      ...createInitialState("vidking", "videasy", LANGUAGE_PROFILES),
      activeModals: [],
    }) as never;
  return fixture;
}

test("u on the results list adds to Up Next; q backs out without enqueueing", () => {
  const queued: SearchResult[] = [];
  let cancelled = false;
  const { handle } = renderBrowse({
    queued,
    initialResults: [trendingOption("Smoke title")],
    onCancel: () => {
      cancelled = true;
    },
  });

  try {
    handle.stdin.enqueue("\u001b[B");
    expect(handle.lastFrame()).toContain("▌");
    handle.stdin.enqueue(["u"]);
    expect(queued).toHaveLength(1);
    expect(queued[0]?.title).toBe("Smoke title");

    handle.stdin.enqueue(["q"]);
    expect(queued).toHaveLength(1);
    expect(cancelled).toBe(false);
    expect(handle.lastFrame()).not.toContain("▌");
  } finally {
    handle.unmount();
  }
});

test("typing q in the search field inserts the character", () => {
  const queued: SearchResult[] = [];
  const { handle } = renderBrowse({ queued });

  try {
    handle.stdin.enqueue(["q"]);
    expect(queued).toEqual([]);
    expect(handle.lastFrame()).toContain("q");
  } finally {
    handle.unmount();
  }
});

describe("root overlay list-back vs filter typing", () => {
  afterEach(() => {
    delete process.env.FORCE_COLOR;
  });

  test("provider picker types q into a non-empty filter and Esc clears it", async () => {
    const fixture = rootOverlayContainer();
    const state = createInitialState("vidking", "videasy", LANGUAGE_PROFILES);
    const handle = render(
      <RootOverlayShell
        overlay={{ type: "provider_picker", currentProvider: "videasy", lane: "series" }}
        state={state}
        container={fixture.container}
        onRedraw={() => {}}
      />,
      { columns: 120, rows: 40 },
    );

    try {
      await waitUntil(() => stripAnsi(handle.lastFrame() ?? "").includes("Videasy"), {
        label: "provider overlay",
      });
      fixture.dispatches.length = 0;
      handle.stdin.enqueue(["v"]);
      await waitUntil(() => stripAnsi(handle.lastFrame() ?? "").includes("Filter: v"), {
        label: "filter v",
      });
      handle.stdin.enqueue(["q"]);
      await waitUntil(() => stripAnsi(handle.lastFrame() ?? "").includes("Filter: vq"), {
        label: "filter vq",
      });

      handle.stdin.enqueue("\x1b");
      await waitUntil(() => stripAnsi(handle.lastFrame() ?? "").includes("Type to filter"), {
        label: "filter cleared",
      });
      expect(fixture.dispatches).toEqual([]);
    } finally {
      handle.unmount();
    }
  });

  test("help overlay backs out on bare q", async () => {
    const fixture = rootOverlayContainer();
    const state = createInitialState("vidking", "videasy", LANGUAGE_PROFILES);
    const handle = render(
      <RootOverlayShell
        overlay={{ type: "help" }}
        state={state}
        container={fixture.container}
        onRedraw={() => {}}
      />,
      { columns: 120, rows: 40 },
    );

    try {
      await waitUntil(() => stripAnsi(handle.lastFrame() ?? "").includes("Help"), {
        label: "help overlay",
      });
      fixture.dispatches.length = 0;
      handle.stdin.enqueue(["q"]);
      await waitUntil(() => fixture.dispatches.includes("close"), { label: "help q closes" });
    } finally {
      handle.unmount();
    }
  });
});
