import { describe, expect, test } from "bun:test";

import type { Logger } from "@/infra/logger/Logger";
import { TracerImpl } from "@/infra/tracer/TracerImpl";

function createLogger(): Logger & { messages: string[] } {
  const messages: string[] = [];
  const logger: Logger & { messages: string[] } = {
    messages,
    debug(message: string) {
      messages.push(message);
    },
    info() {},
    warn() {},
    error() {},
    fatal() {},
    child() {
      return logger;
    },
  } satisfies Logger & { messages: string[] };
  return logger;
}

describe("TracerImpl", () => {
  test("records span attributes and events on the active trace", async () => {
    const logger = createLogger();
    const tracer = new TracerImpl({ outputs: [], logger });

    await tracer.span("session", async (span) => {
      span.setAttribute("titleId", "1396");
      span.addEvent("provider-started", { providerId: "rivestream" });

      const trace = tracer.getCurrentTrace();
      expect(trace?.spans).toHaveLength(1);
      expect(trace?.spans[0]?.attributes).toEqual({ titleId: "1396" });
      expect(trace?.spans[0]?.events[0]?.name).toBe("provider-started");
      expect(trace?.spans[0]?.events[0]?.attributes).toEqual({ providerId: "rivestream" });
      expect(logger.messages).toContain("[provider-started]");
    });

    expect(tracer.getCurrentTrace()).toBeNull();
    expect(tracer.getCurrentSpan()).toBeNull();
  });

  test("keeps nested spans in the same trace while active", async () => {
    const tracer = new TracerImpl({ outputs: [] });

    await tracer.span("session", async () => {
      await tracer.span("playback", async () => {
        const trace = tracer.getCurrentTrace();
        expect(trace?.spans.map((span) => span.name)).toEqual(["session", "playback"]);
      });

      expect(tracer.getCurrentSpan()?.name).toBe("session");
    });
  });
});
