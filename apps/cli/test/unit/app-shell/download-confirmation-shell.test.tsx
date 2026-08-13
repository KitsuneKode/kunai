import { describe, expect, test } from "bun:test";

import { updateDownloadConfirmationProfile } from "@/app-shell/download-confirmation-profile";
import { DownloadConfirmationContent } from "@/app-shell/download-confirmation-shell";
import type { Container } from "@/container";
import type { DownloadConfirmationProfile } from "@/services/download/DownloadIntentService";
import React, { act } from "react";

import { render, stripAnsi } from "../../harness/render-capture";

const ENTER = "\r";
const ARROW_DOWN = "[B";

const PROFILE: DownloadConfirmationProfile = {
  audioPreference: "original",
  subtitlePreference: "en",
  qualityPreference: "best",
  cacheArtwork: true,
  enrollKeepWatchingOffline: false,
  runwayTarget: 2,
  cleanupPolicy: { mode: "keep-last-watched", count: 1 },
};

function container(): Container {
  return {
    config: { downloadPath: "/dl", autoCleanupGraceDays: 7 },
  } as unknown as Container;
}

/**
 * Selecting the action whose label starts with `prefix`, by walking the cursor
 * down from the top. Labels change as the draft changes, so the walk is
 * re-evaluated from the rendered frame each time.
 */
async function activate(
  handle: { stdin: { enqueue: (data: string) => void }; lastFrame: () => string | undefined },
  prefix: string,
): Promise<void> {
  for (let step = 0; step < 12; step += 1) {
    const frame = stripAnsi(handle.lastFrame() ?? "");
    const selectedLine = frame.split("\n").find((line) => line.trimStart().startsWith("▌"));
    if (selectedLine?.includes(prefix)) {
      await act(async () => {
        handle.stdin.enqueue(ENTER);
      });
      return;
    }
    await act(async () => {
      handle.stdin.enqueue(ARROW_DOWN);
    });
  }
  throw new Error(`never reached action ${JSON.stringify(prefix)}`);
}

describe("DownloadConfirmationContent", () => {
  test("a movie reads as one movie with a quiet kind label and no S01E01", () => {
    const handle = render(
      <DownloadConfirmationContent
        title={{ id: "tmdb:1", type: "movie", name: "Dune: Part Two" }}
        mediaKind="movie"
        items={[{ kind: "title" }]}
        initialProfile={PROFILE}
        container={container()}
        onFinish={() => {}}
      />,
      { columns: 140, rows: 40 },
    );
    try {
      const frame = stripAnsi(handle.lastFrame() ?? "");
      expect(frame).toContain("Dune: Part Two");
      expect(frame).toContain("1 movie");
      expect(frame).toContain("Movie");
      expect(frame).not.toContain("S01E01");
      // Movies have no runway or cleanup controls.
      expect(frame).not.toContain("Keep ready ahead");
      expect(frame).not.toContain("After watching");
    } finally {
      handle.unmount();
    }
  });

  test("a series states its canonical position and item count", () => {
    const handle = render(
      <DownloadConfirmationContent
        title={{ id: "tmdb:2", type: "series", name: "Severance" }}
        mediaKind="series"
        items={[{ kind: "episode", episode: { season: 1, episode: 3 } }]}
        initialProfile={PROFILE}
        container={container()}
        onFinish={() => {}}
      />,
      { columns: 140, rows: 40 },
    );
    try {
      const frame = stripAnsi(handle.lastFrame() ?? "");
      expect(frame).toContain("Severance");
      expect(frame).toContain("1 episode");
      expect(frame).toContain("S01E03");
      expect(frame).toContain("Keep ready ahead");
    } finally {
      handle.unmount();
    }
  });

  /**
   * The whole point of mounting once: successive edits must accumulate on one
   * draft. The old loop rebuilt the component per edit, so nothing below could
   * be observed at all.
   */
  test("successive edits accumulate on the same mounted draft", async () => {
    let confirmed: DownloadConfirmationProfile | null = null;
    const handle = render(
      <DownloadConfirmationContent
        title={{ id: "tmdb:2", type: "series", name: "Severance" }}
        mediaKind="series"
        items={[{ kind: "episode", episode: { season: 1, episode: 3 } }]}
        initialProfile={PROFILE}
        container={container()}
        onFinish={(result) => {
          if (result.type === "confirmed") confirmed = result.profile;
        }}
      />,
      { columns: 140, rows: 40 },
    );

    try {
      await activate(handle, "Quality:");
      await activate(handle, "Audio:");
      await activate(handle, "Artwork:");
      await activate(handle, "Queue download");

      expect(confirmed).not.toBeNull();
      // Every earlier edit survived: child-local state was never reset.
      expect(confirmed!.qualityPreference).not.toBe(PROFILE.qualityPreference);
      expect(confirmed!.audioPreference).not.toBe(PROFILE.audioPreference);
      expect(confirmed!.cacheArtwork).toBe(false);
    } finally {
      handle.unmount();
    }
  });

  test("Esc cancels without confirming a profile", async () => {
    const results: string[] = [];
    const handle = render(
      <DownloadConfirmationContent
        title={{ id: "tmdb:1", type: "movie", name: "Dune: Part Two" }}
        mediaKind="movie"
        items={[{ kind: "title" }]}
        initialProfile={PROFILE}
        container={container()}
        onFinish={(result) => results.push(result.type)}
      />,
      { columns: 140, rows: 40 },
    );

    try {
      await act(async () => {
        handle.stdin.enqueue("");
        await new Promise((resolve) => setTimeout(resolve, 60));
      });
      expect(results).toEqual(["cancelled"]);
    } finally {
      handle.unmount();
    }
  });

  test("every rendered line fits the confirmation width", () => {
    const handle = render(
      <DownloadConfirmationContent
        title={{ id: "tmdb:2", type: "series", name: "Severance" }}
        mediaKind="series"
        items={[{ kind: "episode", episode: { season: 1, episode: 3 } }]}
        initialProfile={PROFILE}
        container={container()}
        onFinish={() => {}}
      />,
      { columns: 100, rows: 40 },
    );
    try {
      for (const line of stripAnsi(handle.lastFrame() ?? "").split("\n")) {
        expect(line.length).toBeLessThanOrEqual(100);
      }
    } finally {
      handle.unmount();
    }
  });
});

/**
 * The edit policy is pure and shared by the phase and the shell, so it is
 * asserted directly rather than only through the mounted surface.
 */
describe("updateDownloadConfirmationProfile", () => {
  test("cycle-audio walks the shared settings vocabulary", () => {
    const next = updateDownloadConfirmationProfile(PROFILE, "cycle-audio");
    expect(next.audioPreference).toBe("en");
    expect(updateDownloadConfirmationProfile(next, "cycle-audio").audioPreference).toBe("ja");
  });

  test("edits never mutate the input profile", () => {
    const next = updateDownloadConfirmationProfile(PROFILE, "toggle-artwork");
    expect(next.cacheArtwork).toBe(false);
    expect(PROFILE.cacheArtwork).toBe(true);
  });

  test("runway stays inside its documented bounds", () => {
    let profile: DownloadConfirmationProfile = { ...PROFILE, runwayTarget: 1 };
    profile = updateDownloadConfirmationProfile(profile, "decrease-runway");
    expect(profile.runwayTarget).toBe(1);
    for (let step = 0; step < 20; step += 1) {
      profile = updateDownloadConfirmationProfile(profile, "increase-runway");
    }
    expect(profile.runwayTarget).toBe(10);
  });

  test("toggle-cleanup flips between the two documented policies", () => {
    const toCleanup = updateDownloadConfirmationProfile(PROFILE, "toggle-cleanup", undefined, 5);
    expect(toCleanup.cleanupPolicy).toEqual({ mode: "cleanup-watched", graceDays: 5 });
    expect(updateDownloadConfirmationProfile(toCleanup, "toggle-cleanup").cleanupPolicy).toEqual({
      mode: "keep-last-watched",
      count: 1,
    });
  });
});
