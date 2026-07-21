import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getInstallLayoutPaths } from "@/services/update/native-installer/install-layout";
import {
  beginInstallTransaction,
  finishInstallTransaction,
  inspectInstallTransaction,
  listInstallTransactions,
} from "@/services/update/native-installer/transaction";

async function makeLayout() {
  const root = await mkdtemp(join(tmpdir(), "kunai-txn-"));
  const layout = getInstallLayoutPaths({
    dataDir: join(root, "data"),
    cacheDir: join(root, "cache"),
    configDir: join(root, "config"),
    launcherPath: join(root, "bin", "kunai"),
    platform: "linux",
  });
  await mkdir(layout.transactionsDir, { recursive: true });
  return { root, layout };
}

describe("install transaction records", () => {
  test("begins, lists, inspects, and finishes a transaction", async () => {
    const { root, layout } = await makeLayout();
    const startedAt = "2026-07-20T12:00:00.000Z";

    const record = await beginInstallTransaction(layout, {
      kind: "upgrade",
      version: "1.2.3",
      stagingDir: join(layout.stagingRoot, "1.2.3"),
      startedAt,
    });

    expect(record).toMatchObject({
      schemaVersion: 1,
      kind: "upgrade",
      version: "1.2.3",
      pid: process.pid,
      startedAt,
    });
    expect(record.id.length).toBeGreaterThan(0);
    expect(existsSync(join(layout.transactionsDir, `${record.id}.json`))).toBe(true);

    expect(await listInstallTransactions(layout)).toEqual([record]);
    expect(await inspectInstallTransaction(layout, record.id)).toEqual({
      status: "present",
      record,
    });

    await finishInstallTransaction(layout, record.id);
    expect(await listInstallTransactions(layout)).toEqual([]);
    expect(await inspectInstallTransaction(layout, record.id)).toEqual({
      status: "missing",
    });
    expect(await readdir(layout.transactionsDir)).toEqual([]);

    await rm(root, { recursive: true, force: true });
  });

  test("inspection is read-only for abandoned transaction files", async () => {
    const { root, layout } = await makeLayout();
    const record = await beginInstallTransaction(layout, {
      kind: "install",
      version: "9.9.9",
      pid: 2_147_483_646,
      startedAt: "2020-01-01T00:00:00.000Z",
    });

    const before = await readdir(layout.transactionsDir);
    const inspection = await inspectInstallTransaction(layout, record.id);
    expect(inspection.status).toBe("present");
    expect(await readdir(layout.transactionsDir)).toEqual(before);

    await rm(root, { recursive: true, force: true });
  });
});
