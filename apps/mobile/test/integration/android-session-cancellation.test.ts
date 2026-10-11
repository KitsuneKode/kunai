import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describePosixOnly } from "../support/platform-gates";

describePosixOnly("Android POSIX session cancellation", () => {
  test("emitted Android artifact cancels an active HTTP probe and releases session ownership", async () => {
    const sandbox = mkdtempSync(join(tmpdir(), "kunai-mobile-http-cancel-"));
    const home = join(sandbox, "home");
    const hook = join(sandbox, "cancel-fetch.mjs");
    const choice = join(sandbox, "choice");
    const marker = join(sandbox, "probe-started");
    const root = join(home, ".local/share/kunai-mobile");
    try {
      await Bun.write(choice, "1\n");
      await Bun.write(
        hook,
        `import { writeFileSync } from "node:fs";
globalThis.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
  writeFileSync(process.env.KUNAI_MOBILE_TEST_MARKER, "started");
  signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
  process.kill(process.pid, "SIGINT");
});\n`,
      );
      const child = Bun.spawn(
        [
          process.env.NODE ?? "node",
          "--import",
          hook,
          join(import.meta.dir, "../../dist/android/kunai-mobile-android.mjs"),
          "--host-proof",
          "--probe-url",
          "https://probe.example/status",
          "--media-url",
          "https://media.example/video.mp4",
        ],
        {
          env: { ...process.env, HOME: home, KUNAI_MOBILE_TEST_MARKER: marker },
          stdin: Bun.file(choice),
          stdout: "ignore",
          stderr: "ignore",
        },
      );
      expect(await child.exited).toBe(0);
      expect(child.signalCode).toBeNull();
      expect(readFileSync(marker, "utf8")).toBe("started");
      expect(JSON.parse(readFileSync(join(root, "mobile-state.json"), "utf8"))).toEqual({
        schemaVersion: 1,
        hostProofRuns: 1,
        lastResult: "cancelled",
      });
      expect(existsSync(join(root, "session.lock"))).toBe(false);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
