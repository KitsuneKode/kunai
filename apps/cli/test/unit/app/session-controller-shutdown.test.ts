import { describe, expect, test } from "bun:test";

import { SessionController } from "@/app/SessionController";

describe("SessionController shutdown", () => {
  test("releases persistent player session even when presence shutdown fails", async () => {
    const calls: string[] = [];
    const controller = new SessionController({
      workControl: {
        setActive(value: unknown) {
          calls.push(`work:${String(value)}`);
        },
      },
      presence: {
        async shutdown() {
          calls.push("presence");
          throw new Error("discord pipe timed out");
        },
      },
      player: {
        async releasePersistentSession() {
          calls.push("player");
        },
      },
      diagnosticsService: {
        record(event: { category?: string; message?: string }) {
          calls.push(`diagnostic:${event.category}:${event.message}`);
        },
      },
    } as never);

    await controller.shutdown();

    expect(calls).toContain("work:null");
    expect(calls).toContain("presence");
    expect(calls).toContain("player");
    expect(calls).toContain("diagnostic:session:Session shutdown cleanup failed");
  });
});
