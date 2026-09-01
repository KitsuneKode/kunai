import { describe, expect, test } from "bun:test";

import {
  googleCastTargetFromSelector,
  normalizeGoogleCastDeviceName,
  resolveGoogleCastTargetSelector,
} from "@/services/playback/cast/cast-target-selector";

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

  test("matches discovered names while treating curly and straight apostrophes equally", async () => {
    const target = {
      kind: "google-cast" as const,
      id: "tv-1",
      name: "Viewer’s TV",
      host: "192.168.1.50",
      port: 8009,
      capabilities: ["audio", "video"] as const,
    };

    expect(normalizeGoogleCastDeviceName(" Viewer's TV ")).toBe("viewer's tv");
    expect(await resolveGoogleCastTargetSelector("Viewer's TV", async () => [target])).toEqual(
      target,
    );
  });

  test("rejects friendly names that do not identify a discovered receiver", async () => {
    expect(resolveGoogleCastTargetSelector("This doesn't exist", async () => [])).rejects.toThrow(
      "Google Cast device not found: This doesn't exist",
    );
  });
});
