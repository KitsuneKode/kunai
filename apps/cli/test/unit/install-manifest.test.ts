import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readInstallManifest, writeInstallManifest } from "@/services/update/install-manifest";

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

test("write then read round-trips the manifest", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kunai-manifest-"));
  made.push(dir);
  await writeInstallManifest(
    { channel: "binary", version: "1.2.3", binPath: "/x/kunai", dlBase: "https://dl" },
    dir,
  );
  const m = await readInstallManifest(dir);
  expect(m?.channel).toBe("binary");
  expect(m?.version).toBe("1.2.3");
  expect(m?.binPath).toBe("/x/kunai");
  expect(typeof m?.installedAt).toBe("string");
});

test("read returns null when manifest is absent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kunai-manifest-"));
  made.push(dir);
  expect(await readInstallManifest(dir)).toBeNull();
});

test("read returns null on corrupt manifest", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kunai-manifest-"));
  made.push(dir);
  await Bun.write(join(dir, "install.json"), "{ not valid json");
  expect(await readInstallManifest(dir)).toBeNull();
});
