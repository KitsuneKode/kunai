import { describe, expect, test } from "bun:test";

import { googleCastTargetFromSelector } from "@/services/playback/cast/cast-target-selector";

describe("Google Cast target selector", () => {
  test("keeps a friendly name for mDNS resolution", () => {
    expect(googleCastTargetFromSelector("Living Room TV")).toEqual({
      kind: "google-cast",
      id: "name:living room tv",
      name: "Living Room TV",
      capabilities: ["audio", "video"],
    });
  });

  test("accepts direct IPv4 and local-host endpoints when multicast is unavailable", () => {
    expect(googleCastTargetFromSelector("192.168.1.20")).toMatchObject({
      host: "192.168.1.20",
      port: 8009,
    });
    expect(googleCastTargetFromSelector("living-room.local:9009")).toMatchObject({
      host: "living-room.local",
      port: 9009,
    });
  });
});
