import { describe, expect, test } from "bun:test";

describe("post-playback root content kind", () => {
  test("openPlaybackShell selects post-playback when postPlayState is present", async () => {
    const source = await Bun.file(
      new URL("../../../src/app-shell/ink-shell.tsx", import.meta.url),
    ).text();
    expect(source).toContain('kind: state.postPlayState ? "post-playback" : "playback"');
  });
});
