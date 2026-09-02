import { describe, expect, test } from "bun:test";

import {
  buildGoogleCastMdnsQuery,
  googleCastTargetFromService,
} from "@/services/playback/cast/google-cast-discovery-service";

describe("Google Cast discovery mapping", () => {
  test("builds a standard PTR query for _googlecast._tcp.local", () => {
    const query = buildGoogleCastMdnsQuery();
    const view = new DataView(query.buffer, query.byteOffset, query.byteLength);

    expect(view.getUint16(4)).toBe(1);
    expect(new TextDecoder().decode(query)).toContain("_googlecast");
    expect(view.getUint16(query.length - 4)).toBe(12);
    expect(view.getUint16(query.length - 2)).toBe(0x8001);
  });

  test("uses stable TXT identity and classifies video receivers", () => {
    const target = googleCastTargetFromService({
      name: "Living-Room",
      fqdn: "Living-Room._googlecast._tcp.local",
      port: 8009,
      addresses: ["192.168.1.20"],
      txt: { id: "device-1", fn: "Living Room TV", md: "Chromecast", ca: "5" },
    });

    expect(target).toEqual({
      kind: "google-cast",
      id: "device-1",
      name: "Living Room TV",
      host: "192.168.1.20",
      port: 8009,
      modelName: "Chromecast",
      capabilities: ["audio", "video"],
    });
  });

  test("rejects an unresolved service instead of publishing an unusable target", () => {
    expect(
      googleCastTargetFromService({
        name: "Unknown",
        fqdn: "Unknown._googlecast._tcp.local",
        port: 8009,
        addresses: [],
      }),
    ).toBeNull();
  });
});
