import { expect, test } from "bun:test";

import { runRootWorkflowSafely } from "@/app-shell/root-workflow-dispatch";
import type { Container } from "@/container";

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
