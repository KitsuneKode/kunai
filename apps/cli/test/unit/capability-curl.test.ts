import { describe, expect, test } from "bun:test";

import { __testing, probeCapabilities } from "@/ui";

/**
 * A PATH stub: every listed command resolves, everything else is absent.
 *
 * The real probe reads the host's PATH, so without this seam these assertions
 * would depend on whatever the developer happens to have installed.
 */
function pathWith(...commands: readonly string[]) {
  return (command: string) => (commands.includes(command) ? `/usr/bin/${command}` : null);
}

describe("probeCapabilities — curl for the default anime provider", () => {
  test("reports curl present when plain curl is on PATH", async () => {
    const snapshot = await probeCapabilities({ which: pathWith("curl") });

    expect(snapshot.curl).toBe(true);
    expect(snapshot.issues.map((issue) => issue.id)).not.toContain("curl-missing");
  });

  test("reports curl present when only a curl-impersonate build is on PATH", async () => {
    // AniDB prefers an impersonate build over plain curl, so probing for the
    // literal "curl" would report missing on a host that is fully capable.
    const snapshot = await probeCapabilities({ which: pathWith("curl_chrome136") });

    expect(snapshot.curl).toBe(true);
    expect(snapshot.issues.map((issue) => issue.id)).not.toContain("curl-missing");
  });

  test("raises a degraded issue when no curl variant exists", async () => {
    const snapshot = await probeCapabilities({ which: pathWith("mpv", "yt-dlp", "ffprobe") });

    expect(snapshot.curl).toBe(false);
    const issue = snapshot.issues.find((candidate) => candidate.id === "curl-missing");
    expect(issue).toBeDefined();
    // Anime is one mode, so a missing curl degrades rather than blocks the shell.
    expect(issue?.severity).toBe("degraded");
    // The message has to name what actually breaks; "curl not found" alone
    // gives the user no reason to care.
    expect(issue?.message).toContain("AniDB");
    expect(issue?.remediation.length).toBeGreaterThan(0);
  });

  test("probes each dependency independently", async () => {
    const snapshot = await probeCapabilities({ which: pathWith("curl") });

    expect(snapshot.mpv).toBe(false);
    expect(snapshot.ytDlp).toBe(false);
    expect(snapshot.ffprobe).toBe(false);
    expect(snapshot.curl).toBe(true);
  });

  test("defaults to the real PATH when no probe is injected", async () => {
    const snapshot = await probeCapabilities();

    expect(typeof snapshot.curl).toBe("boolean");
  });

  test("the probed flag reaches the capability fingerprint", async () => {
    // The fingerprint decides whether the remediation notice is shown again, so
    // a curl that appears or disappears has to change it — otherwise the user
    // installs curl and is still told it is missing, or vice versa.
    const withCurl = await probeCapabilities({ which: pathWith("curl") });
    const withoutCurl = await probeCapabilities({ which: pathWith("mpv") });

    expect(__testing.capabilityFingerprint(withCurl)).not.toBe(
      __testing.capabilityFingerprint(withoutCurl),
    );
  });
});
