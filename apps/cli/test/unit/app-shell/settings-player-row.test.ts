import { expect, test } from "bun:test";

import { playerOptions } from "@/app-shell/settings/registry/playback";

// The saved player (Neon features review: no persisted player choice). VLC is
// an Android handoff target only; desktop playback is mpv.
test("Settings offers VLC on Android only", () => {
  expect(playerOptions("android").map((option) => option.value)).toEqual(["auto", "mpv", "vlc"]);
  for (const platform of ["linux", "darwin", "win32"] as const) {
    expect(playerOptions(platform).map((option) => option.value)).toEqual(["auto", "mpv"]);
  }
});
