import { describe, expect, test } from "bun:test";

import { __testing, probeCapabilities } from "@/ui";

/**
 * A synthetic PATH: the listed commands are the only executables that exist.
 *
 * Both seams are injected together on purpose. `which` alone is no longer
 * enough now that curl-impersonate builds are *discovered* by listing PATH
 * rather than looked up by name — leaving `listPathEntries` to its default
 * would let whatever the developer happens to have installed decide the result,
 * which is exactly the non-determinism this stub exists to prevent.
 */
function pathWith(...commands: readonly string[]) {
  return {
    which: (command: string) => (commands.includes(command) ? `/usr/bin/${command}` : null),
    listPathEntries: () => commands,
  };
}

/**
 * The same synthetic PATH, resolved the way Windows resolves one.
 *
 * `Bun.which("curl")` finds `curl.exe` there because PATHEXT is applied, so a
 * stub that only matched the literal name would fail a case the real runtime
 * passes — testing the stub rather than the code.
 */
function windowsPathWith(...commands: readonly string[]) {
  const PATHEXT = ["", ".exe", ".bat", ".cmd"];
  return {
    which: (command: string) => {
      const hit = PATHEXT.map((ext) => `${command}${ext}`).find((name) => commands.includes(name));
      return hit ? `C:\\tools\\${hit}` : null;
    },
    listPathEntries: () => commands,
  };
}

describe("probeCapabilities — curl for the default anime provider", () => {
  test("reports plain curl as present but not impersonating", async () => {
    const snapshot = await probeCapabilities(pathWith("curl"));

    expect(snapshot.curl.present).toBe(true);
    expect(snapshot.curl.impersonates).toBe(false);
    expect(snapshot.curl.profile).toBeNull();
    expect(snapshot.issues.map((issue) => issue.id)).not.toContain("curl-missing");
  });

  test("reports an impersonate build with the profile it selected", async () => {
    const snapshot = await probeCapabilities(pathWith("curl_chrome150"));

    expect(snapshot.curl).toEqual({
      present: true,
      impersonates: true,
      profile: "chrome150",
    });
    expect(snapshot.issues.map((issue) => issue.id)).not.toContain("curl-missing");
    expect(snapshot.issues.map((issue) => issue.id)).not.toContain("curl-impersonate-missing");
  });

  // The regression that motivated widening this field. Plain curl exists on
  // nearly every machine, so the old boolean reported "ready" while Cloudflare
  // challenged every request and anime search silently returned nothing.
  test("raises a degraded issue when only plain curl is available", async () => {
    const snapshot = await probeCapabilities(pathWith("curl", "mpv"));

    const issue = snapshot.issues.find((c) => c.id === "curl-impersonate-missing");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("degraded");
    // The remediation must be actionable and must not invent a package that
    // does not exist — upstream ships no Debian, Fedora, or Windows package.
    expect(issue?.remediation.join("\n")).toContain("brew install lexiforest/tap/curl-impersonate");
    expect(issue?.remediation.join("\n")).toContain("pacman -S curl-impersonate");
    expect(issue?.remediation.join("\n")).not.toContain("apt install curl-impersonate");
  });

  test("raises a degraded issue when no curl variant exists", async () => {
    const snapshot = await probeCapabilities(pathWith("mpv", "yt-dlp", "ffprobe"));

    expect(snapshot.curl.present).toBe(false);
    const issue = snapshot.issues.find((candidate) => candidate.id === "curl-missing");
    expect(issue).toBeDefined();
    // Anime is one mode, so a missing curl degrades rather than blocks the shell.
    expect(issue?.severity).toBe("degraded");
    // The message has to name what actually breaks; "curl not found" alone
    // gives the user no reason to care.
    expect(issue?.message).toContain("AniDB");
    expect(issue?.remediation.length).toBeGreaterThan(0);
    // Only one curl issue at a time, or the notice reads as two problems.
    expect(snapshot.issues.map((i) => i.id)).not.toContain("curl-impersonate-missing");
  });

  test("probes each dependency independently", async () => {
    const snapshot = await probeCapabilities(pathWith("curl"));

    expect(snapshot.mpv).toBe(false);
    expect(snapshot.ytDlp).toBe(false);
    expect(snapshot.ffprobe).toBe(false);
    expect(snapshot.curl.present).toBe(true);
  });

  test("defaults to the real PATH when no probe is injected", async () => {
    const snapshot = await probeCapabilities();

    expect(typeof snapshot.curl.present).toBe("boolean");
    expect(typeof snapshot.curl.impersonates).toBe("boolean");
  });

  test("the probed capability reaches the capability fingerprint", async () => {
    // The fingerprint decides whether the remediation notice is shown again, so
    // a curl that appears or disappears has to change it — otherwise the user
    // installs curl and is still told it is missing, or vice versa.
    const withCurl = await probeCapabilities(pathWith("curl"));
    const withoutCurl = await probeCapabilities(pathWith("mpv"));

    expect(__testing.capabilityFingerprint(withCurl)).not.toBe(
      __testing.capabilityFingerprint(withoutCurl),
    );
  });

  // Installing curl-impersonate alongside an existing plain curl changes what
  // Kunai can do, so it has to re-show the notice rather than staying quiet.
  test("upgrading from plain curl to an impersonate build changes the fingerprint", async () => {
    const plain = await probeCapabilities(pathWith("curl"));
    const impersonating = await probeCapabilities(pathWith("curl", "curl_chrome150"));

    expect(__testing.capabilityFingerprint(plain)).not.toBe(
      __testing.capabilityFingerprint(impersonating),
    );
  });

  // The Windows archive contains `.bat` wrappers around curl-impersonate.exe and
  // no extensionless ones, so a discovery pattern that accepted only `.exe`
  // could never see a correctly installed Windows setup — it reported "plain
  // curl, no CF bypass" forever and the user had nothing left to try.
  test("discovers the .bat wrappers the Windows release actually ships", async () => {
    const snapshot = await probeCapabilities(
      pathWith("curl.exe", "curl_chrome150.bat", "curl_chrome116.bat"),
    );

    expect(snapshot.curl).toMatchObject({
      present: true,
      impersonates: true,
      profile: "chrome150",
    });
    expect(snapshot.issues.map((issue) => issue.id)).not.toContain("curl-impersonate-missing");
  });

  test("ranks .cmd and extensionless wrappers by build, not by extension", async () => {
    const snapshot = await probeCapabilities(
      pathWith("curl", "curl_chrome116", "curl_chrome150.cmd"),
    );

    expect(snapshot.curl.profile).toBe("chrome150");
  });

  // `curl.exe` is still plain curl. Treating any `.exe` as an impersonate build
  // would report a CF bypass that does not exist.
  test("plain curl.exe is not mistaken for an impersonate build", async () => {
    const snapshot = await probeCapabilities(windowsPathWith("curl.exe"));

    expect(snapshot.curl.present).toBe(true);
    expect(snapshot.curl.impersonates).toBe(false);
  });
});
