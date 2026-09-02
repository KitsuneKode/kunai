import { describe, expect, test } from "bun:test";

import { parseAvahiGoogleCastTargets } from "@/services/playback/cast/google-cast-native-discovery-service";

describe("Google Cast native discovery", () => {
  test("maps resolved IPv4 Avahi rows and decodes escaped UTF-8 names", () => {
    const targets = parseAvahiGoogleCastTargets(
      '=;wlan0;IPv4;Chromecast-Ultra;_googlecast._tcp;local;cast.local;192.168.1.50;8009;"ca=201221" "fn=Viewer\\226\\128\\153s TV" "md=Chromecast Ultra" "id=cast-123"',
    );

    expect(targets).toEqual([
      {
        kind: "google-cast",
        id: "cast-123",
        name: "Viewer’s TV",
        host: "192.168.1.50",
        port: 8009,
        modelName: "Chromecast Ultra",
        capabilities: ["audio", "video"],
      },
    ]);
  });

  test("ignores unresolved announcements and IPv6 link-local rows", () => {
    expect(
      parseAvahiGoogleCastTargets(
        '+;wlan0;IPv4;Cast;_googlecast._tcp;local\n=;wlan0;IPv6;Cast;_googlecast._tcp;local;cast.local;fe80::1;8009;"fn=Cast"',
      ),
    ).toEqual([]);
  });
});
