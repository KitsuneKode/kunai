import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildPtyCommand } from "../helpers/pty-command";

test.skipIf(process.platform === "win32" || !Bun.which("expect"))(
  "macOS PTY wrapper records output even when console echo is disabled",
  () => {
    const dir = mkdtempSync(join(tmpdir(), "kunai-pty-transcript-"));
    try {
      const transcript = join(dir, "output.log");
      const child = Bun.spawnSync(
        buildPtyCommand("printf 'handler-ran\\n'; exit 7", transcript, "darwin"),
        {
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      expect(child.exitCode).toBe(7);
      expect(child.stdout.toString()).toBe("");
      expect(readFileSync(transcript, "utf8")).toContain("handler-ran");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
