import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as pickers from "@/app-shell/pickers";
import { openOfflineLibraryGroupPicker } from "@/app-shell/workflows/shell-workflows";
import type { DiagnosticEventInput } from "@/services/diagnostics/diagnostic-event";
import type { OfflineLibraryEntry } from "@/services/offline/offline-library";
import { routeOfflineLibraryGroupAction } from "@/services/offline/offline-library-action-router";

import { applyStorageRootEnv } from "../../../helpers/storage-env";
import { createContainerFixture } from "../../../support/container-fixture";

function pickSpy() {
  return spyOn(pickers, "chooseFromListShell");
}
let picker: ReturnType<typeof pickSpy>;
let root: string;
let restore: () => void;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kunai-offline-actions-"));
  restore = applyStorageRootEnv(root);
  picker = pickSpy();
});
afterEach(() => {
  picker.mockRestore();
  restore();
  rmSync(root, { recursive: true, force: true });
});

function entry(id: string, status: OfflineLibraryEntry["status"]): OfflineLibraryEntry {
  return {
    status,
    job: {
      id,
      titleId: "title",
      titleName: "Offline title",
      mediaKind: "series",
      providerId: "fixture",
      status: "completed",
      outputPath: join(root, `${id}.mp4`),
      tempPath: join(root, `${id}.part`),
      streamUrl: "https://example.invalid/video",
      headers: {},
      progressPercent: 100,
      season: 1,
      episode: 1,
      retryCount: 0,
      maxAttempts: 3,
      attempt: 1,
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-01T00:00:00Z",
    },
  };
}

function fixture() {
  const events: { type: string; note?: string; query?: string }[] = [];
  const diagnostics: DiagnosticEventInput[] = [];
  const retried: string[] = [];
  const metadata: string[][] = [];
  const queued: string[] = [];
  const deleted: string[] = [];
  const protection: string[][] = [];
  const protectedIds: string[] = [];
  const config = {
    protectedDownloadJobIds: protectedIds,
    offlineDefaultRunwayTarget: 3,
    autoCleanupGraceDays: 7,
    update: async ({ protectedDownloadJobIds }: { protectedDownloadJobIds: string[] }) => {
      config.protectedDownloadJobIds = protectedDownloadJobIds;
      protection.push(protectedDownloadJobIds);
    },
    save: async () => {},
  };
  // SAFETY: These offline action tests exercise only the supplied in-memory ports.
  const { container } = createContainerFixture({
    config,
    connectivity: { isOnline: () => false },
    historyRepository: { listByTitle: () => [] },
    offlineTitlePolicies: { get: () => undefined },
    stateManager: { dispatch: (event: (typeof events)[number]) => events.push(event) },
    diagnosticsService: { record: (event: DiagnosticEventInput) => diagnostics.push(event) },
    downloadService: {
      retry: (id: string) => retried.push(id),
      repairArtifactMetadata: async (ids: string[]) => {
        metadata.push(ids);
        return ids.length;
      },
      kickQueue: (reason: string) => queued.push(reason),
      deleteJob: async (id: string) => {
        deleted.push(id);
        return id === "blocked"
          ? { status: "retained", jobId: id, reason: "File in use" }
          : { status: "deleted", jobId: id };
      },
    },
  } as never);
  return { container, events, diagnostics, retried, metadata, queued, deleted, protection };
}

test("shared integrity and search actions retain the workflow diagnostics", async () => {
  const f = fixture();
  const ready = entry("ready", "ready");
  const outputPath = ready.job.outputPath;
  if (!outputPath) throw new Error("Missing fixture output path");
  writeFileSync(outputPath, "media");
  await routeOfflineLibraryGroupAction(f.container, [ready, entry("missing", "missing")], {
    type: "check-integrity",
  });
  expect(f.diagnostics[0]).toMatchObject({
    operation: "download.artifact.integrity.checked",
    context: { total: 2, issueCount: 1 },
  });
  expect(
    await routeOfflineLibraryGroupAction(f.container, [ready], { type: "search-online" }),
  ).toBe("exit");
  expect(f.events).toContainEqual({ type: "SET_SEARCH_QUERY", query: "Offline title" });
  expect(f.diagnostics[1]?.operation).toBe("search.offline-continuation.requested");
});

test("workflow repair uses the shared file and metadata repair path", async () => {
  const f = fixture();
  picker.mockResolvedValueOnce({ type: "repair-missing" }).mockResolvedValueOnce({ type: "back" });
  await openOfflineLibraryGroupPicker(f.container, [
    entry("missing", "missing"),
    entry("metadata", "ready"),
  ]);
  expect(f.retried).toEqual(["missing"]);
  expect(f.metadata).toEqual([["metadata"]]);
  expect(picker).toHaveBeenCalledTimes(1);
  expect(f.queued).toEqual(["offline-repair"]);
});

test("workflow protection and unprotection share the persisted set", async () => {
  const f = fixture();
  picker
    .mockResolvedValueOnce({ type: "protect-group" })
    .mockResolvedValueOnce({ type: "unprotect-group" })
    .mockResolvedValueOnce({ type: "back" });
  await openOfflineLibraryGroupPicker(f.container, [entry("protected", "ready")]);
  expect(f.protection).toEqual([["protected"], []]);
});

test("cancelled and partially failed deletion retain local entries", async () => {
  const f = fixture();
  const removed = entry("removed", "ready");
  const entries = [removed, entry("blocked", "ready")];
  picker.mockResolvedValueOnce(false);
  expect(await routeOfflineLibraryGroupAction(f.container, entries, { type: "delete-group" })).toBe(
    "continue",
  );
  expect(f.deleted).toEqual([]);
  expect(
    picker.mock.calls[0]?.[0].options.find((option) => option.value === true)?.destructive,
  ).toBe(true);
  picker.mockResolvedValueOnce(true);
  expect(await routeOfflineLibraryGroupAction(f.container, entries, { type: "delete-group" })).toBe(
    "continue",
  );
  expect(f.events.at(-1)?.note).toBe("Removed 1; kept 1. File in use");
  picker.mockResolvedValueOnce(true);
  expect(
    await routeOfflineLibraryGroupAction(f.container, [removed], { type: "delete-group" }),
  ).toBe("exit");
});
