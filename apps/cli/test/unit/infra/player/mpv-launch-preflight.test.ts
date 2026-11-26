import { describe, expect, test } from "bun:test";

import { launchPreflight } from "@/infra/player/mpv-launch-preflight";

// Every case here must settle without a network request: a fetch to the
// unroutable test host would hang or fail, not return "reachable".
const REMOTE = "https://cdn.invalid/episode.mp4";

describe("launchPreflight", () => {
  test("a URL the resolve gate verified moments ago is not probed again", async () => {
    await expect(
      launchPreflight({
        url: REMOTE,
        headers: {},
        resolveGate: {
          timestamp: Date.now(),
          // SAFETY: the preflight reads only streamReachabilityVerified from the result.
          providerResolveResult: { streamReachabilityVerified: true } as never,
        },
      }),
    ).resolves.toMatchObject({ status: "reachable" });
  });

  test("addon streams and local files skip the lenient probe", async () => {
    await expect(
      launchPreflight({ url: REMOTE, headers: {}, stremioAddon: true }),
    ).resolves.toEqual({ status: "reachable" });
    await expect(
      launchPreflight({ url: "/media/episode.mkv", urlKind: "local", headers: {} }),
    ).resolves.toEqual({ status: "reachable" });
  });
});
