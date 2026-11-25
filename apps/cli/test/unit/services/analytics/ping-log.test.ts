import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  filePingLog,
  PING_LOG_FILE_NAME,
  PING_LOG_LIMIT,
  pingLogPath,
} from "@/services/analytics/ping-log";

import { removeTempDir } from "../../../support/remove-temp-dir";

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) removeTempDir(dir);
});

function tempLog() {
  const dir = mkdtempSync(join(tmpdir(), "kunai-ping-log-"));
  made.push(dir);
  const path = pingLogPath(dir);
  return { path, log: filePingLog(path) };
}

const entry = (n: number) => ({
  sentAt: new Date(Date.UTC(2026, 10, 1) + n * 86_400_000).toISOString(),
  endpoint: "https://analytics.example.test/api/ping",
  body: JSON.stringify({ n }),
});

describe("file ping log", () => {
  test("lives in the data dir under its own name", () => {
    expect(pingLogPath("/data")).toBe(join("/data", PING_LOG_FILE_NAME));
  });

  test("a missing file reads as empty and is not created by reading", async () => {
    const { path, log } = tempLog();
    expect(await log.read()).toEqual([]);
    expect(existsSync(path)).toBe(false);
  });

  test("keeps bodies byte for byte, oldest first", async () => {
    const { log } = tempLog();
    await log.append(entry(1));
    await log.append(entry(2));
    expect(await log.read()).toEqual([entry(1), entry(2)]);
  });

  test(`keeps only the last ${PING_LOG_LIMIT}`, async () => {
    const { log } = tempLog();
    for (let n = 0; n < PING_LOG_LIMIT + 5; n++) await log.append(entry(n));
    const entries = await log.read();
    expect(entries).toHaveLength(PING_LOG_LIMIT);
    expect(entries[0]).toEqual(entry(5));
    expect(entries.at(-1)).toEqual(entry(PING_LOG_LIMIT + 4));
  });

  test.skipIf(process.platform === "win32")("is readable by its owner only", async () => {
    const { path, log } = tempLog();
    await log.append(entry(1));
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  test("remove deletes the file, and is quiet when there is none", async () => {
    const { path, log } = tempLog();
    await log.append(entry(1));
    await log.remove();
    expect(existsSync(path)).toBe(false);
    await log.remove();
  });

  test("a corrupt file reads as empty instead of failing", async () => {
    const { path, log } = tempLog();
    writeFileSync(path, "{not json");
    expect(await log.read()).toEqual([]);
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, pings: [entry(1), { body: 3 }] }));
    expect(await log.read()).toEqual([entry(1)]);
  });
});
