import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bootSurface } from "./frame-match";
import { startTmuxSession } from "./tmux-session";

const itTmux = Bun.which("tmux") ? it : it.skip;

describe("tmux session env validation", () => {
  itTmux("rejects a hostile env name and cleans up its sandbox", async () => {
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

  itTmux("rejects a missing env name entirely", async () => {
    await expect(
      startTmuxSession({ name: `envreject2-${process.pid}`, env: { "=v": "1" } }),
    ).rejects.toThrow(/invalid env name/);
  });

  itTmux("does not execute command substitution in an env value", async () => {
    const evidenceRoot = mkdtempSync(join(tmpdir(), "kunai-env-proof-"));
    const marker = join(evidenceRoot, "executed");
    const s = await startTmuxSession({
      name: `envliteral-${process.pid}`,
      command: "--offline",
      env: { KUNAI_LITERAL_PROBE: `$(touch '${marker}')` },
    });
    try {
      await s.waitFor((frame) => bootSurface(frame) === "Library", "offline shell");
      expect(existsSync(marker)).toBe(false);
    } finally {
      await s.stop();
      rmSync(evidenceRoot, { recursive: true, force: true });
    }
  });

  itTmux("rejects a storage-root override before launching", async () => {
    const name = `envvault-${process.pid}`;
    const before = readdirSync(tmpdir()).filter((d) => d.includes(name));
    await expect(
      startTmuxSession({
        name,
        env: { HOME: join(tmpdir(), `kunai-foreign-home-${process.pid}`) },
      }),
    ).rejects.toThrow(/cannot override isolated profile env/);
    expect(readdirSync(tmpdir()).filter((d) => d.includes(name))).toEqual(before);
  });
});
