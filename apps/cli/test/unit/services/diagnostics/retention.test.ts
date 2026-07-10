import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pruneOldestFiles } from "@/services/diagnostics/prune-oldest-files";
import {
  DIAGNOSTICS_EXPORT_FILE_PATTERN,
  DIAGNOSTICS_FILE_RETENTION,
  DIAGNOSTICS_TRACE_FILE_PATTERN,
  pruneOldDiagnosticFiles,
} from "@/services/diagnostics/retention";

describe("pruneOldestFiles", () => {
  test("keeps only the newest matching export files (12 → 10)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kunai-prune-exports-"));
    try {
      const base = Date.now() / 1000;
      for (let index = 0; index < 12; index += 1) {
        const name = `kunai-diagnostics-export-2026-07-10T00-00-${String(index).padStart(2, "0")}.json`;
        const path = join(dir, name);
        await writeFile(path, "{}");
        // Distinct mtimes so retention order is deterministic across filesystems.
        await utimes(path, base + index, base + index);
      }
      await writeFile(join(dir, "unrelated-notes.txt"), "keep");

      await pruneOldestFiles(dir, DIAGNOSTICS_EXPORT_FILE_PATTERN, DIAGNOSTICS_FILE_RETENTION);

      const files = (await readdir(dir)).sort();
      expect(files).toEqual([
        "kunai-diagnostics-export-2026-07-10T00-00-02.json",
        "kunai-diagnostics-export-2026-07-10T00-00-03.json",
        "kunai-diagnostics-export-2026-07-10T00-00-04.json",
        "kunai-diagnostics-export-2026-07-10T00-00-05.json",
        "kunai-diagnostics-export-2026-07-10T00-00-06.json",
        "kunai-diagnostics-export-2026-07-10T00-00-07.json",
        "kunai-diagnostics-export-2026-07-10T00-00-08.json",
        "kunai-diagnostics-export-2026-07-10T00-00-09.json",
        "kunai-diagnostics-export-2026-07-10T00-00-10.json",
        "kunai-diagnostics-export-2026-07-10T00-00-11.json",
        "unrelated-notes.txt",
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("keeps only the newest matching trace files (12 → 10)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kunai-prune-traces-"));
    try {
      const base = Date.now() / 1000;
      for (let index = 0; index < 12; index += 1) {
        const name = `kunai-trace-${String(index).padStart(2, "0")}.jsonl`;
        const path = join(dir, name);
        await writeFile(path, "");
        await utimes(path, base + index, base + index);
      }

      await pruneOldestFiles(dir, DIAGNOSTICS_TRACE_FILE_PATTERN, DIAGNOSTICS_FILE_RETENTION);

      const files = (await readdir(dir)).sort();
      expect(files).toHaveLength(10);
      expect(files[0]).toBe("kunai-trace-02.jsonl");
      expect(files[9]).toBe("kunai-trace-11.jsonl");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("no-ops when directory is missing", async () => {
    await pruneOldestFiles(
      join(tmpdir(), "kunai-prune-missing-dir-does-not-exist"),
      DIAGNOSTICS_TRACE_FILE_PATTERN,
      10,
    );
  });
});

describe("pruneOldDiagnosticFiles (prefix compatibility)", () => {
  test("keeps only the newest matching files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kunai-retention-"));
    try {
      const base = Date.now() / 1000;
      for (let index = 0; index < 12; index += 1) {
        const path = join(dir, `kunai-trace-${String(index).padStart(2, "0")}.jsonl`);
        await writeFile(path, "");
        await utimes(path, base + index, base + index);
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
});
