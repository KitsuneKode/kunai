import { expect, test } from "bun:test";

import { clearRootContentSession, mountRootContent } from "@/app-shell/root-content-state";
import { runRootWorkflowSafely } from "@/app-shell/root-workflow-dispatch";
import type { BrowseShellResult } from "@/app-shell/types";
import type { Container } from "@/container";
import type { SearchResult } from "@/domain/types";
import type { ReactElement } from "react";

test("contains a root workflow loader failure with feedback and diagnostics", async () => {
  const notes: string[] = [];
  const events: Array<{ operation?: string }> = [];
  const container = {
    stateManager: { dispatch: (event: { note?: string }) => notes.push(event.note ?? "") },
    diagnosticsService: { record: (event: { operation?: string }) => events.push(event) },
  } as unknown as Container;

  await expect(
    runRootWorkflowSafely({
      container,
      action: "sync",
      loadWorkflow: async () => {
        throw new Error("module unavailable");
      },
    }),
  ).resolves.toBeUndefined();

  expect(notes[0]).toContain("Could not run sync");
  expect(events[0]?.operation).toBe("shell.workflow.failed");
});

function mountBrowse() {
  return mountRootContent<BrowseShellResult<SearchResult>>({
    kind: "browse",
    renderContent: () => null as unknown as ReactElement,
    fallbackValue: { type: "cancelled" },
  });
}

const noopContainer = {
  stateManager: { dispatch: () => {} },
  diagnosticsService: { record: () => {} },
} as unknown as Container;

// This result used to be awaited and discarded, so a workflow that asked to
// start playing something reported success and played nothing.
test("a workflow asking for playback settles the mounted browse session", async () => {
  const mounted = mountBrowse();
  const title = { id: "tmdb:1", type: "series" as const, name: "Example" };
  const episode = { season: 1, episode: 2 };

  await runRootWorkflowSafely({
    container: noopContainer,
    action: "sync",
    loadWorkflow: async () =>
      ({
        runShellWorkflowFromOverlay: async () => ({ type: "history-entry", title, episode }),
      }) as never,
  });

  expect(await mounted.result).toEqual({
    type: "launch-playback",
    launch: { title, episode },
  });
});

test("a workflow with no playback result leaves the browse session mounted", async () => {
  const mounted = mountBrowse();
  let settled = false;
  void mounted.result.then(() => (settled = true));

  await runRootWorkflowSafely({
    container: noopContainer,
    action: "sync",
    loadWorkflow: async () => ({ runShellWorkflowFromOverlay: async () => "handled" }) as never,
  });
  await Promise.resolve();

  expect(settled).toBe(false);
  mounted.close({ type: "cancelled" });
  clearRootContentSession();
});
