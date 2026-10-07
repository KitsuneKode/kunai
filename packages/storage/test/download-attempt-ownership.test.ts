import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DownloadJobsRepository, openKunaiDatabase, runMigrations } from "../src";

const opened: ReturnType<typeof openKunaiDatabase>[] = [];
const roots: string[] = [];
afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function twoOwners() {
  const root = mkdtempSync(join(tmpdir(), "kunai-download-owner-"));
  roots.push(root);
  const first = openKunaiDatabase(join(root, "data.sqlite"));
  runMigrations(first, "data");
  const second = openKunaiDatabase(join(root, "data.sqlite"));
  opened.push(first, second);
  const a = new DownloadJobsRepository(first);
  const b = new DownloadJobsRepository(second);
  const at = new Date().toISOString();
  a.enqueue({
    id: "job",
    titleId: "tmdb:1",
    titleName: "Fixture",
    mediaKind: "movie",
    providerId: "vidking",
    streamUrl: "https://example.com/video.mp4",
    headers: {},
    outputPath: join(root, "video.mp4"),
    tempPath: join(root, ".tmp.job.mp4"),
    createdAt: at,
    updatedAt: at,
  });
  return { a, b, second, at };
}

test("recovery revokes every mutation and external effect from the old attempt", () => {
  const { a, b, at } = twoOwners();
  const old = a.markRunning("job", at)!;
  const recovery = b.claimRunningForRecovery("job", at, at, old.generation)!;
  expect(recovery.generation).toBe(old.generation + 1);
  expect(recovery.ownerToken).not.toBe(old.ownerToken);
  expect(recovery.stagingDir).toBe(old.stagingDir);
  expect(b.get("job")?.stagingDir).toBe(old.stagingDir);
  let effects = 0;
  expect(
    a.withRunningClaim(old, () => {
      effects += 1;
    }).owned,
  ).toBe(false);
  expect(effects).toBe(0);
  expect(a.markHeartbeat("job", at, old)).toBe(false);
  expect(a.updateProgress("job", 90, at, old)).toBe(false);
  expect(
    a.updateResolvedStream(
      "job",
      { streamUrl: "https://example.com/old.mp4", headers: {} },
      at,
      old,
    ),
  ).toBe(false);
  expect(a.updateOfflineMetadata("job", { subtitlePath: "old.srt" }, at, old)).toBe(false);
  expect(a.updateFileSize("job", 100, at, old)).toBe(false);
  expect(a.complete("job", at, old)).toBe(false);
  expect(a.scheduleRetry("job", "old failure", at, at, old)).toBe(false);
  expect(a.abort("job", at, old)).toBe(false);
  expect(b.get("job")?.status).toBe("running");
  expect(b.complete("job", at, recovery)).toBe(true);
});

test("a fenced effect holds the writer lock until its synchronous result returns", () => {
  const { a, b, second, at } = twoOwners();
  const owner = a.markRunning("job", at)!;
  second.exec("PRAGMA busy_timeout = 0");
  const outcome = a.withRunningClaim(owner, () => {
    expect(() => b.abort("job", at)).toThrow();
    return "launched";
  });
  expect(outcome).toEqual({ owned: true, value: "launched" });
  expect(b.abort("job", at)).toBe(true);
  expect(a.withRunningClaim(owner, () => "late")).toEqual({ owned: false });
});

// The typecheck gate must reject effects that can resume after the writer lock is released.
function asyncEffectsAreNotClaimEffects(
  repo: DownloadJobsRepository,
  claim: NonNullable<ReturnType<DownloadJobsRepository["markRunning"]>>,
) {
  // @ts-expect-error asynchronous effects cannot be fenced by a synchronous transaction
  repo.withRunningClaim(claim, async () => undefined);
}
void asyncEffectsAreNotClaimEffects;

test("a stale recovery snapshot cannot reclaim a replacement with the same heartbeat", () => {
  const { a, b, at } = twoOwners();
  const old = a.markRunning("job", at)!;
  expect(b.claimRunningForRecovery("job", at, at, old.generation)).toBeDefined();
  expect(a.claimRunningForRecovery("job", at, at, old.generation)).toBeUndefined();
});

test("a new transfer after recovery never reuses the retained proof directory", () => {
  const { a, b, at } = twoOwners();
  const old = a.markRunning("job", at)!;
  const recovery = b.claimRunningForRecovery("job", at, at, old.generation)!;
  expect(b.scheduleRetry("job", "interrupted", at, at, recovery)).toBe(true);
  const next = b.markRunning("job", at)!;
  expect(next.stagingDir).not.toBe(old.stagingDir);
  expect(next.generation).toBeGreaterThan(recovery.generation);
});

test("retry cannot revoke a running claim admitted after a stale queued read", () => {
  const { a, b, at } = twoOwners();
  expect(a.get("job")?.status).toBe("queued");
  const owner = b.markRunning("job", at)!;
  a.requeue("job", at);
  expect(b.get("job")?.status).toBe("running");
  expect(b.withRunningClaim(owner, () => "owned")).toEqual({ owned: true, value: "owned" });
});
