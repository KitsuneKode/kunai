import { expect, test } from "bun:test";

import { recordCliStartupMilestone } from "@/services/diagnostics/cli-startup-milestone";
import type { DiagnosticEventInput } from "@/services/diagnostics/diagnostic-event";

test("records a privacy-safe startup milestone", () => {
  const events: unknown[] = [];
  recordCliStartupMilestone(
    {
      record: (event: DiagnosticEventInput) => {
        events.push(event);
      },
    } as never,
    "browse-mounted",
  );

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    category: "session",
    operation: "session.startup.browse-mounted",
    context: { elapsedMs: expect.any(Number) },
  });
  expect(JSON.stringify(events[0])).not.toContain("query");
  expect(JSON.stringify(events[0])).not.toContain("title");
});
