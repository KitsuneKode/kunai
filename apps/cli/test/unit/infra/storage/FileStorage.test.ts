import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FileStorage } from "@/infra/storage/FileStorage";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("FileStorage", () => {
  test("keeps the write queue usable after a failed write", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kunai-file-storage-"));
    tempDirs.push(dir);
    const storage = new FileStorage({ config: dir });
    await expect(storage.write("config", { broken: true })).rejects.toThrow();

    const configPath = join(dir, "config.json");
    const recovered = new FileStorage({ config: configPath });
    await recovered.write("config", { ok: true });

    await expect(recovered.read<{ ok: boolean }>("config")).resolves.toEqual({ ok: true });
    await expect(readFile(configPath, "utf8")).resolves.toContain('"ok": true');
  });
});
