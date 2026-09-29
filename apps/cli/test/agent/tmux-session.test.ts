import { describe, expect, it } from "bun:test";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";

import { startTmuxSession } from "./tmux-session";

describe("tmux session env validation", () => {
  it("rejects a hostile env name and cleans up its sandbox", async () => {
    const name = `envreject-${process.pid}`;
    const before = readdirSync(tmpdir()).filter((d) => d.includes(name));
    await expect(startTmuxSession({ name, env: { "X; id #": "v" } })).rejects.toThrow(
      /invalid env name/,
    );
    // The launch-script sink throws inside the guarded region — the owned
    // profile must be disposed and no tmux session may be left behind.
    const after = readdirSync(tmpdir()).filter((d) => d.includes(name));
    expect(after).toEqual(before);
  });

  it("rejects a missing env name entirely", async () => {
    await expect(
      startTmuxSession({ name: `envreject2-${process.pid}`, env: { "=v": "1" } }),
    ).rejects.toThrow(/invalid env name/);
  });
});
