import { describe, expect, test } from "bun:test";

import { SessionController } from "@/app/session/SessionController";

describe("SessionController shutdown", () => {
  test("releases persistent player session even when presence shutdown fails", async () => {
    const calls: string[] = [];
    const controller = new SessionController({
      workControl: {
        cancelActive(reason: string) {
          calls.push(`work:cancel:${reason}`);
        },
      },
      presence: {
        async shutdown() {
          calls.push("presence");
          throw new Error("discord pipe timed out");
        },
      },
      player: {
        beginShutdown() {
          calls.push("player:begin-shutdown");
        },
        async releasePersistentSession() {
          calls.push("player:release");
        },
      },
      diagnosticsService: {
        record(event: { category?: string; message?: string }) {
          calls.push(`diagnostic:${event.category}:${event.message}`);
        },
      },
    } as never);

    await controller.shutdown();

    expect(calls).toContain("work:cancel:shutdown");
    expect(calls).toContain("presence");
    expect(calls).toContain("player:begin-shutdown");
    expect(calls).toContain("player:release");
    expect(calls).toContain("diagnostic:session:Session shutdown cleanup failed");
  });
});
