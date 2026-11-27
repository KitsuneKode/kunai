import { describe, expect, test } from "bun:test";

import { buildDependencyRows } from "@/app-shell/setup/dependency-rows";
import { buildSetupVerdict, setupDensity } from "@/app-shell/setup/setup-verdict";
import { CURL_IMPERSONATE_INSTALL, MPV_INSTALL, YT_DLP_INSTALL } from "@/infra/os/install-commands";
import type { CapabilityIssue, CapabilitySnapshot } from "@/ui";

const issue = (
  id: CapabilityIssue["id"],
  install: CapabilityIssue["install"],
): CapabilityIssue => ({
  id,
  severity: "degraded",
  message: id,
  remediation: [],
  install,
});

function snapshot(overrides: Partial<CapabilitySnapshot> = {}): CapabilitySnapshot {
  return {
    mpv: true,
    mpvRequired: true,
    vlc: false,
    vlcRequired: false,
    ffprobe: true,
    ytDlp: true,
    curl: { present: true, impersonates: true, profile: "chrome150" },
    image: {
      terminal: "unknown",
      protocol: "none",
      renderer: "none",
      available: false,
      reason: "test fixture",
    },
    issues: [],
    ...overrides,
  };
}

/** Pretend to be Arch, so the "one command" is deterministic on any host. */
const pacmanOnly = (command: string) => (command === "pacman" ? "/usr/bin/pacman" : null);

function verdict(
  snap: CapabilitySnapshot,
  lane: "series" | "anime" | "youtube",
  density: "wide" | "narrow" | "tiny" = "wide",
  playerName?: string,
) {
  return buildSetupVerdict({
    snapshot: snap,
    rows: buildDependencyRows(snap, { which: pacmanOnly }),
    lane,
    density,
    playerName,
  });
}

const kinds = (v: ReturnType<typeof verdict>) => v.lines.map((line) => line.kind);
const texts = (v: ReturnType<typeof verdict>) => v.lines.map((line) => line.text);

describe("setup verdict", () => {
  test("a machine with mpv is one line and asks for nothing", () => {
    const v = verdict(snapshot(), "series");
    expect(texts(v)).toEqual(["Ready to play in mpv"]);
    expect(v.attention).toBe(false);
    expect(v.playerReady).toBe(true);
  });

  test("a VLC-only machine is ready, and says VLC", () => {
    // `--player auto` resolved to VLC, so mpv is not required.
    const vlcOnly = snapshot({ mpv: false, mpvRequired: false, vlc: true, vlcRequired: true });
    const v = verdict(vlcOnly, "series");
    expect(texts(v)).toEqual(["Ready to play in VLC"]);
    expect(v.attention).toBe(false);
    expect(v.playerReady).toBe(true);
  });

  test("a hand-off session is ready in the player the caller names", () => {
    // Android hands playback to another app: neither managed player is required.
    const handoff = snapshot({ mpv: false, mpvRequired: false });
    expect(texts(verdict(handoff, "series", "wide", "your video player"))).toEqual([
      "Ready to play in your video player",
    ]);
  });

  test("VLC asked for by name and absent is the thing that is missing", () => {
    const snap = snapshot({
      mpvRequired: false,
      vlcRequired: true,
      issues: [issue("vlc-missing", { arch: "sudo pacman -S vlc" })],
    });
    const v = verdict(snap, "series");
    expect(texts(v)).toEqual([
      "VLC not found — nothing can play yet",
      "sudo pacman -S vlc",
      "Install it, then press r — or start Kunai with --player mpv.",
    ]);
    expect(v.playerReady).toBe(false);
  });

  test("no player says what is missing, the one command, and the key that re-checks", () => {
    const snap = snapshot({
      mpv: false,
      issues: [issue("mpv-missing", MPV_INSTALL)],
    });
    const v = verdict(snap, "series");
    expect(kinds(v)).toEqual(["blocked", "command", "hint"]);
    expect(texts(v)).toEqual([
      "No video player found — nothing can play yet",
      "sudo pacman -S mpv",
      "Run it in another terminal, then press r. VLC works too.",
    ]);
    expect(v.attention).toBe(true);
    expect(v.playerReady).toBe(false);
  });

  test("the same state fits the size floor in three short lines", () => {
    const snap = snapshot({ mpv: false, issues: [issue("mpv-missing", MPV_INSTALL)] });
    const lines = texts(verdict(snap, "series", "tiny"));
    expect(lines).toEqual([
      "No video player found",
      "sudo pacman -S mpv",
      "then press r · VLC works too",
    ]);
    // 40 columns minus the frame gutter and the two-column indent.
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(32);
  });

  test("curl-impersonate is raised only to someone about to choose anime", () => {
    const snap = snapshot({
      curl: { present: true, impersonates: false, profile: null },
      issues: [issue("curl-impersonate-missing", CURL_IMPERSONATE_INSTALL)],
    });
    expect(texts(verdict(snap, "series"))).toEqual(["Ready to play in mpv"]);
    expect(verdict(snap, "series").attention).toBe(false);
    expect(texts(verdict(snap, "youtube"))).toEqual(["Ready to play in mpv"]);

    const anime = verdict(snap, "anime");
    expect(kinds(anime)).toEqual(["ok", "warn", "command", "hint"]);
    expect(texts(anime)[1]).toBe("Anime search can come back empty here");
    expect(texts(anime)[2]).toBe("sudo pacman -S curl-impersonate");
    expect(anime.attention).toBe(true);
    // Still ready: the lane is degraded, playback is not blocked.
    expect(anime.playerReady).toBe(true);
  });

  test("yt-dlp is raised only to someone about to choose YouTube", () => {
    const snap = snapshot({ ytDlp: false, issues: [issue("yt-dlp-missing", YT_DLP_INSTALL)] });
    expect(verdict(snap, "anime").attention).toBe(false);
    const youtube = verdict(snap, "youtube");
    expect(texts(youtube)).toEqual([
      "Ready to play in mpv",
      "YouTube needs yt-dlp",
      "sudo pacman -S yt-dlp",
    ]);
  });

  test("a fix with no command for this machine names the problem without inventing one", () => {
    // curl-impersonate has no package on Debian; the row falls back to a URL.
    const snap = snapshot({
      curl: { present: true, impersonates: false, profile: null },
      issues: [issue("curl-impersonate-missing", { note: "" })],
    });
    const v = buildSetupVerdict({
      snapshot: snap,
      rows: buildDependencyRows(snap, { which: () => null }).map((row) =>
        row.id === "curl-impersonate" ? { ...row, fix: null } : row,
      ),
      lane: "anime",
      density: "narrow",
    });
    expect(kinds(v)).toEqual(["ok", "warn"]);
  });
});

describe("setup density", () => {
  test("follows the space the screen gets", () => {
    expect(setupDensity(80, 30)).toBe("wide");
    expect(setupDensity(48, 25)).toBe("narrow");
    expect(setupDensity(80, 25)).toBe("narrow");
    expect(setupDensity(34, 16)).toBe("tiny");
    expect(setupDensity(80, 16)).toBe("tiny");
    // Too short for the layout the width alone would pick: step down rather
    // than let the screen drop rows.
    expect(setupDensity(48, 24)).toBe("tiny");
    expect(setupDensity(80, 23)).toBe("tiny");
  });
});
