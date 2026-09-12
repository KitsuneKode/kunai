import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pruneOldDiagnosticFiles } from "@/services/diagnostics/retention";

describe("diagnostics retention", () => {
  test("keeps only the newest matching files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kunai-retention-"));
    try {
      for (let index = 0; index < 12; index += 1) {
        await writeFile(join(dir, `kunai-trace-${String(index).padStart(2, "0")}.jsonl`), "");
      }

      await pruneOldDiagnosticFiles({
        dir,
        prefix: "kunai-trace-",
        maxFiles: 10,
      });

      const files = (await readdir(dir)).sort();
      expect(files).toHaveLength(10);
      expect(files[0]).toBe("kunai-trace-02.jsonl");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // Creating a symlink on Windows needs a privilege an unelevated CI job does
  // not have, and the behaviour under test is the stat call, not the platform.
  test.skipIf(process.platform === "win32")(
    "ages a symlink by the link itself, never by what it points at",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "kunai-retention-"));
      const outside = await mkdtemp(join(tmpdir(), "kunai-retention-target-"));
      try {
        // The target is old and lives outside the pruned directory. Reading its
        // mtime through the link is what let a planted link decide which real
        // diagnostics files counted as newest.
        const target = join(outside, "precious.jsonl");
        await writeFile(target, "keep me");
        await utimes(target, new Date("2020-01-01T00:00:00Z"), new Date("2020-01-01T00:00:00Z"));

        const real = join(dir, "kunai-trace-real.jsonl");
        await writeFile(real, "");
        await utimes(real, new Date("2021-01-01T00:00:00Z"), new Date("2021-01-01T00:00:00Z"));

        const link = join(dir, "kunai-trace-link.jsonl");
        await symlink(target, link);

        await pruneOldDiagnosticFiles({ dir, prefix: "kunai-trace-", maxFiles: 1 });

        // Judged as itself the link is the newest entry, so it is the one kept.
        // Judged by its target it would read as 2020 — older than the real file
        // — and the real diagnostics file would have been deleted instead.
        expect(await readdir(dir)).toEqual(["kunai-trace-link.jsonl"]);
        // Pruning unlinks the link, never the file it names.
        expect(await readFile(target, "utf8")).toBe("keep me");
      } finally {
        await rm(dir, { recursive: true, force: true });
        await rm(outside, { recursive: true, force: true });
      }
    },
  );
});
