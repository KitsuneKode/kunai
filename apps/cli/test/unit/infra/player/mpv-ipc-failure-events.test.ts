import { describe, expect, test } from "bun:test";

import { isSubtitleIpcCommand, mpvIpcFailureEvents } from "@/infra/player/mpv-ipc-failure-events";

describe("mpvIpcFailureEvents", () => {
  test("a successful command reports nothing", () => {
    expect(
      mpvIpcFailureEvents({ ok: true, command: ["loadfile"], requestId: 1, response: {} }),
    ).toEqual([]);
  });

  test("a failure reports the command, and a timeout also reports a stall", () => {
    const failed = {
      ok: false,
      command: ["set_property"],
      requestId: 1,
      error: "invalid",
    } as const;
    expect(mpvIpcFailureEvents(failed)).toEqual([
      { type: "ipc-command-failed", command: "set_property", error: "invalid" },
    ]);
    const timedOut = { ok: false, command: ["seek"], requestId: 2, error: "timeout" } as const;
    expect(mpvIpcFailureEvents(timedOut)).toEqual([
      { type: "ipc-command-failed", command: "seek", error: "timeout" },
      { type: "ipc-stalled", command: "seek", error: "timeout" },
    ]);
  });

  test("an exempt command's timeout is a failure, not a stall", () => {
    const subtitle = { ok: false, command: ["sub-add"], requestId: 3, error: "timeout" } as const;
    expect(mpvIpcFailureEvents(subtitle, isSubtitleIpcCommand)).toEqual([
      { type: "ipc-command-failed", command: "sub-add", error: "timeout" },
    ]);
  });
});
