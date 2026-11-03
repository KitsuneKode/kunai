import { describe, expect, test } from "bun:test";

import {
  isMagnetOrTorrentHash,
  normalizeMagnetUri,
  runPlayMagnetCommand,
} from "@/services/debrid/run-play-magnet";

describe("run-play-magnet", () => {
  test("identifies magnet URIs and bare torrent hashes", () => {
    expect(
      isMagnetOrTorrentHash("magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567"),
    ).toBe(true);
    expect(isMagnetOrTorrentHash("0123456789abcdef0123456789abcdef01234567")).toBe(true);
    expect(
      isMagnetOrTorrentHash("0123456789abcdef0123456789abcdef012345670123456789abcdef01234567"),
    ).toBe(true);
    expect(isMagnetOrTorrentHash("https://example.com/video.mp4")).toBe(false);
    expect(isMagnetOrTorrentHash("not a magnet")).toBe(false);
  });

  test("normalizes bare torrent hashes into magnet URIs", () => {
    const hash40 = "0123456789abcdef0123456789abcdef01234567";
    expect(normalizeMagnetUri(hash40)).toBe(`magnet:?xt=urn:btih:${hash40}`);

    const magnet = "magnet:?xt=urn:btih:abc&dn=test";
    expect(normalizeMagnetUri(magnet)).toBe(magnet);
  });

  test("returns exit code 1 with helpful message if no debrid services are configured", async () => {
    let stderr = "";
    const originalStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: string | Uint8Array): boolean => {
      stderr += String(chunk);
      return true;
    };

    try {
      const exitCode = await runPlayMagnetCommand("magnet:?xt=urn:btih:123", {
        getEnv: () => undefined,
      });

      expect(exitCode).toBe(1);
      expect(stderr).toContain("no Debrid service is configured");
      expect(stderr).toContain("REAL_DEBRID_API_KEY");
    } finally {
      process.stderr.write = originalStderr;
    }
  });

  test("dry-run mode resolves without launching player", async () => {
    const mockToken = "mock_rd_token";
    let stdout = "";
    const originalStdout = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Uint8Array): boolean => {
      stdout += String(chunk);
      return true;
    };

    try {
      const testFetch = async (url: string | URL | Request) => {
        const u = String(url);
        if (u.includes("/torrents/instantAvailability/")) {
          return new Response(JSON.stringify({}), { status: 200 });
        }
        if (u.includes("/torrents/addMagnet")) {
          return new Response(
            JSON.stringify({
              id: "T123",
              uri: "https://api.real-debrid.com/rest/1.0/torrents/info/T123",
            }),
            { status: 201 },
          );
        }
        if (u.includes("/torrents/selectFiles/")) {
          return new Response(null, { status: 204 });
        }
        if (u.includes("/torrents/info/T123")) {
          return new Response(
            JSON.stringify({
              id: "T123",
              filename: "Frieren_01_1080p.mkv",
              bytes: 1400000000,
              status: "downloaded",
              links: ["https://real-debrid.com/d/LINK123"],
            }),
            { status: 200 },
          );
        }
        if (u.includes("/unrestrict/link")) {
          return new Response(
            JSON.stringify({
              id: "U123",
              filename: "Frieren_01_1080p.mkv",
              filesize: 1400000000,
              download: "https://download.real-debrid.com/d/LINK123/Frieren_01_1080p.mkv",
            }),
            { status: 200 },
          );
        }
        return new Response("Not found", { status: 404 });
      };

      const exitCode = await runPlayMagnetCommand(
        "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567",
        {
          getEnv: (key) => (key === "REAL_DEBRID_API_KEY" ? mockToken : undefined),
          fetchFn: testFetch,
          dryRun: true,
        },
      );

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Resolving magnet stream via Real-Debrid");
      expect(stdout).toContain("Frieren_01_1080p.mkv");
      expect(stdout).toContain("[dry-run] URL:");
    } finally {
      process.stdout.write = originalStdout;
    }
  });
});
