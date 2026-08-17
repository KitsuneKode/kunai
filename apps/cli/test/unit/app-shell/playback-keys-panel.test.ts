import { describe, expect, test } from "bun:test";

import {
  buildPlaybackKeysPanel,
  PLAYBACK_KEYS_PANEL_SESSIONS,
} from "@/app-shell/playback-keys-panel";

const allRows = (model: ReturnType<typeof buildPlaybackKeysPanel>) =>
  model.groups.flatMap((group) => group.rows);

describe("playback keys panel", () => {
  test("retires itself after a few playbacks", () => {
    // The card exists to teach the keys once, not to become wallpaper.
    expect(buildPlaybackKeysPanel({ contentKind: "series", sessionsSeen: 0 }).visible).toBe(true);
    expect(
      buildPlaybackKeysPanel({
        contentKind: "series",
        sessionsSeen: PLAYBACK_KEYS_PANEL_SESSIONS - 1,
      }).visible,
    ).toBe(true);
    expect(
      buildPlaybackKeysPanel({ contentKind: "series", sessionsSeen: PLAYBACK_KEYS_PANEL_SESSIONS })
        .visible,
    ).toBe(false);
  });

  test("stays hidden when suppressed, however new the install is", () => {
    expect(
      buildPlaybackKeysPanel({ contentKind: "series", sessionsSeen: 0, suppressed: true }).visible,
    ).toBe(false);
  });

  test("a movie is not offered keys that point at nothing", () => {
    const labels = allRows(buildPlaybackKeysPanel({ contentKind: "movie", sessionsSeen: 0 })).map(
      (row) => row.label,
    );

    expect(labels).not.toContain("next");
    expect(labels).not.toContain("prev");
    expect(labels).not.toContain("episodes");
    // The stream and session keys still apply to a movie.
    expect(labels).toContain("source");
    expect(labels).toContain("autoskip");
    expect(labels).toContain("stop");
  });

  test("an anime film is not offered episode keys", () => {
    const labels = allRows(
      buildPlaybackKeysPanel({ contentKind: "anime", titleType: "movie", sessionsSeen: 0 }),
    ).map((row) => row.label);

    expect(labels).not.toContain("next");
    expect(labels).not.toContain("prev");
    expect(labels).not.toContain("episodes");
  });

  test("a series gets the episode keys", () => {
    const labels = allRows(buildPlaybackKeysPanel({ contentKind: "series", sessionsSeen: 0 })).map(
      (row) => row.label,
    );

    expect(labels).toContain("next");
    expect(labels).toContain("prev");
    expect(labels).toContain("episodes");
  });

  test("keys come from the registry, not a hand-written list", () => {
    const rows = allRows(buildPlaybackKeysPanel({ contentKind: "series", sessionsSeen: 0 }));
    const autoskip = rows.find((row) => row.label === "autoskip");
    const source = rows.find((row) => row.label === "source");

    // These are the registry's real chords; a divergent copy would drift the
    // moment a binding changed, which is how the old hardcoded hint line ended
    // up advertising episode keys on movies.
    expect(autoskip?.keys).toBe("u");
    expect(source?.keys).toBe("o");
  });

  test("points at the full list so dismissing it is never a dead end", () => {
    expect(buildPlaybackKeysPanel({ contentKind: "series", sessionsSeen: 0 }).footnote).toContain(
      "?",
    );
  });
});
