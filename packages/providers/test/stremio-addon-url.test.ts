import { describe, expect, test } from "bun:test";

import {
  isStremioAddonProviderId,
  parseStremioAddonUrl,
  scrubStremioAddonText,
  stremioAddonDisplayLabel,
  stremioAddonHasPrivateConfiguration,
  stremioStreamUrl,
  stremioVideoId,
} from "../src/stremio-addon/addon-url";

function parsed(url: string) {
  const result = parseStremioAddonUrl(url);
  if (!result.ok) throw new Error(`expected ${url} to parse: ${result.reason}`);
  return result.addon;
}

describe("addon manifest URL", () => {
  test("accepts an https manifest URL and derives base, host and id from it", () => {
    const addon = parsed("  https://addon.example.com/abc123/manifest.json ");

    expect(addon.manifestUrl).toBe("https://addon.example.com/abc123/manifest.json");
    expect(addon.baseUrl).toBe("https://addon.example.com/abc123");
    expect(addon.host).toBe("addon.example.com");
    expect(addon.providerId).toMatch(/^stremio-addon-example-com-[0-9a-f]{8}$/);
    expect(isStremioAddonProviderId(addon.providerId)).toBe(true);
  });

  test("reads the stremio:// form as the same address", () => {
    expect(parsed("stremio://addon.example.com/manifest.json")).toEqual(
      parsed("https://addon.example.com/manifest.json"),
    );
  });

  test("the id is stable for one URL and differs between two configurations of one host", () => {
    const first = parsed("https://addon.example.com/token-a/manifest.json");
    const again = parsed("https://addon.example.com/token-a/manifest.json");
    const other = parsed("https://addon.example.com/token-b/manifest.json");

    expect(first.providerId).toBe(again.providerId);
    expect(first.providerId).not.toBe(other.providerId);
  });

  test("the id never contains the path, which may hold a token", () => {
    const addon = parsed("https://addon.example.com/SECRETTOKEN/manifest.json");

    expect(addon.providerId.toLowerCase()).not.toContain("secrettoken");
    expect(addon.host).not.toContain("SECRETTOKEN");
  });

  test.each([
    ["", "Type an addon"],
    ["not a url", "not a URL"],
    ["http://addon.example.com/manifest.json", "https://"],
    ["https://user:pass@addon.example.com/manifest.json", "username or password"],
    ["https://addon.example.com/manifest.json?token=1", "query string"],
    ["https://addon.example.com/", "/manifest.json"],
    ["https://addon.example.com/configure", "/manifest.json"],
    ["https://127.0.0.1/manifest.json", "public host"],
    ["https://localhost/manifest.json", "public host"],
    ["https://192.168.1.10/manifest.json", "public host"],
    ["https://[::1]/manifest.json", "public host"],
  ])("refuses %p with a reason", (url, reason) => {
    const result = parseStremioAddonUrl(url);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain(reason);
  });
});

describe("addon resource paths", () => {
  test("a movie is asked for by IMDb id", () => {
    const addon = parsed("https://addon.example.com/cfg/manifest.json");

    expect(stremioStreamUrl(addon, "movie", stremioVideoId("tt1375666"))).toBe(
      "https://addon.example.com/cfg/stream/movie/tt1375666.json",
    );
  });

  test("an episode is asked for as id:season:episode, encoded as one path segment", () => {
    const addon = parsed("https://addon.example.com/manifest.json");
    const videoId = stremioVideoId("tt0944947", { season: 1, episode: 2 });

    expect(videoId).toBe("tt0944947:1:2");
    expect(stremioStreamUrl(addon, "series", videoId)).toBe(
      "https://addon.example.com/stream/series/tt0944947%3A1%3A2.json",
    );
  });
});

describe("addon private configuration", () => {
  test("a path before manifest.json marks the URL as private configuration", () => {
    expect(stremioAddonHasPrivateConfiguration("https://addon.example.com/manifest.json")).toBe(
      false,
    );
    expect(stremioAddonHasPrivateConfiguration("https://addon.example.com/cfg/manifest.json")).toBe(
      true,
    );
    expect(
      stremioAddonHasPrivateConfiguration("https://addon.example.com/manifest.json?token=x"),
    ).toBe(true);
    expect(
      stremioAddonHasPrivateConfiguration("https://user:pw@addon.example.com/manifest.json"),
    ).toBe(true);
    expect(stremioAddonHasPrivateConfiguration("not a url")).toBe(true);
  });

  test("the display label is host-only, marked when the install is configured", () => {
    expect(
      stremioAddonDisplayLabel({
        host: "addon.example.com",
        manifestUrl: "https://addon.example.com/manifest.json",
      }),
    ).toBe("addon.example.com");
    expect(
      stremioAddonDisplayLabel({
        host: "addon.example.com",
        manifestUrl: "https://addon.example.com/cfg/manifest.json",
      }),
    ).toBe("addon @ addon.example.com");
  });
});

describe("addon text scrubbing", () => {
  const CANARY = "CanaryToken2026";
  const configured = `https://addon.example.com/key=${CANARY}&opt=plain/manifest.json`;

  test("a compound path secret is removed in the forms it can take", () => {
    expect(scrubStremioAddonText(`Echo ${CANARY}`, configured)).toBe("Echo [redacted]");
    expect(scrubStremioAddonText("Echo key=CanaryToken2026&opt=plain", configured)).toBe(
      "Echo [redacted]",
    );
  });

  test("a percent-encoded compound secret is removed decoded", () => {
    const url = `https://addon.example.com/key%3D${CANARY}%26opt%3Don/manifest.json`;
    expect(scrubStremioAddonText(`Echo ${CANARY}`, url)).toBe("Echo [redacted]");
    expect(scrubStremioAddonText(`Echo key%3D${CANARY}%26opt%3Don`, url)).toBe("Echo [redacted]");
  });

  test("a base64url-encoded secret is removed decoded", () => {
    const encoded = Buffer.from(CANARY).toString("base64url");
    const url = `https://addon.example.com/${encoded}/manifest.json`;
    expect(scrubStremioAddonText(`Echo ${CANARY}`, url)).toBe("Echo [redacted]");
    expect(scrubStremioAddonText(`Echo ${encoded}`, url)).toBe("Echo [redacted]");
  });

  test("a base64url-encoded JSON object gives up the token inside", () => {
    const encoded = Buffer.from(`{"opt":"${CANARY}"}`).toString("base64url");
    const url = `https://addon.example.com/${encoded}/manifest.json`;
    expect(scrubStremioAddonText(`Echo ${CANARY}`, url)).toBe("Echo [redacted]");
  });

  test("query values are scrubbed even though the URL parser refuses them", () => {
    const url = `https://addon.example.com/manifest.json?token=${CANARY}`;
    expect(scrubStremioAddonText(`Echo ${CANARY}`, url)).toBe("Echo [redacted]");
  });

  test("an absolute URL inside addon text is never trusted display data", () => {
    expect(scrubStremioAddonText("mirror https://tracker.example.com/abc", configured)).toBe(
      "mirror [redacted]",
    );
  });
});
