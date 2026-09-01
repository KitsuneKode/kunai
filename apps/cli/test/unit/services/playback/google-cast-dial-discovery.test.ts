import { describe, expect, test } from "bun:test";

import {
  googleCastTargetFromDialDescription,
  isGoogleCastDialResponse,
  isPrivateLanIpv4,
} from "@/services/playback/cast/google-cast-dial-discovery-service";

describe("Google Cast DIAL discovery", () => {
  test("recognises DIAL SSDP responses without accepting unrelated devices", () => {
    expect(
      isGoogleCastDialResponse(
        "HTTP/1.1 200 OK\r\nST: urn:dial-multiscreen-org:service:dial:1\r\n",
      ),
    ).toBe(true);
    expect(isGoogleCastDialResponse("HTTP/1.1 200 OK\r\nST: upnp:rootdevice\r\n")).toBe(false);
  });

  test("maps a private-LAN DIAL description to the Cast control endpoint", () => {
    const target = googleCastTargetFromDialDescription(
      "192.168.1.50",
      `<?xml version="1.0"?><root><device><friendlyName>Living Room TV</friendlyName><modelName>Google TV</modelName><UDN>uuid:tv-123</UDN></device></root>`,
    );

    expect(target).toEqual({
      kind: "google-cast",
      id: "tv-123",
      name: "Living Room TV",
      host: "192.168.1.50",
      port: 8009,
      modelName: "Google TV",
      capabilities: ["audio", "video"],
    });
  });

  test("refuses public and malformed responder addresses", () => {
    expect(isPrivateLanIpv4("192.168.1.50")).toBe(true);
    expect(isPrivateLanIpv4("8.8.8.8")).toBe(false);
    expect(
      googleCastTargetFromDialDescription("8.8.8.8", "<friendlyName>TV</friendlyName>"),
    ).toBeNull();
  });
});
