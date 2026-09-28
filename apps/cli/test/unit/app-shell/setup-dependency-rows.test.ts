import { describe, expect, test } from "bun:test";

import { buildDependencyRows, selectStartupIssueRows } from "@/app-shell/setup/dependency-rows";
import {
  buildRemediationLines,
  CURL_IMPERSONATE_INSTALL,
  CURL_INSTALL,
  FFMPEG_INSTALL,
  MPV_INSTALL,
  resolveInstallCommand,
  YT_DLP_INSTALL,
} from "@/infra/os/install-commands";
import { probeCapabilities } from "@/ui";

const NOTHING = { which: () => null, listPathEntries: () => [] };

async function bareSnapshot() {
  return probeCapabilities(NOTHING);
}

describe("resolveInstallCommand", () => {
  test("returns the macOS command on darwin", () => {
    expect(resolveInstallCommand(FFMPEG_INSTALL, { platform: "darwin" })).toBe(
      "brew install ffmpeg",
    );
  });

  test("returns the Windows command on win32", () => {
    expect(resolveInstallCommand(FFMPEG_INSTALL, { platform: "win32" })).toBe(
      "winget install Gyan.FFmpeg",
    );
  });

  test("picks the Linux command from the package manager actually present", () => {
    // Probing beats reading /etc/os-release: a user is described by what they
    // can run, not by what their distro claims to be.
    expect(
      resolveInstallCommand(FFMPEG_INSTALL, {
        platform: "linux",
        which: (command) => (command === "dnf" ? "/usr/bin/dnf" : null),
      }),
    ).toBe("sudo dnf install ffmpeg");
  });

  test("falls back when no package manager is recognised", () => {
    expect(resolveInstallCommand(FFMPEG_INSTALL, { platform: "linux", which: () => null })).toBe(
      "https://ffmpeg.org/download.html",
    );
  });

  test("never invents a package for a platform upstream does not ship", () => {
    // curl-impersonate has no Debian, Fedora, or Windows package. Naming one
    // would be a command that does not exist, which is worse than no hint.
    const debian = resolveInstallCommand(CURL_IMPERSONATE_INSTALL, {
      platform: "linux",
      which: (command) => (command === "apt" ? "/usr/bin/apt" : null),
    });
    expect(debian).toBe("https://github.com/lexiforest/curl-impersonate/releases");
    expect(resolveInstallCommand(CURL_IMPERSONATE_INSTALL, { platform: "win32" })).toBe(
      "https://github.com/lexiforest/curl-impersonate/releases",
    );
    expect(YT_DLP_INSTALL.win32).toBe("winget install --id yt-dlp.yt-dlp -e");
    expect(buildRemediationLines(CURL_IMPERSONATE_INSTALL).join("\n")).not.toContain("apt install");
  });
});

describe("every dependency is installable on every platform we ship to", () => {
  const INSTALLS = {
    mpv: MPV_INSTALL,
    "yt-dlp": YT_DLP_INSTALL,
    ffmpeg: FFMPEG_INSTALL,
    curl: CURL_INSTALL,
    "curl-impersonate": CURL_IMPERSONATE_INSTALL,
  } as const;

  const LINUX_HOSTS = [
    ["arch", "pacman"],
    ["debian", "apt"],
    ["fedora", "dnf"],
    ["opensuse", "zypper"],
    // A minimal container, an immutable distro, Nix: no recognised manager.
    ["unknown", null],
  ] as const;

  // Every previous macOS/Windows CI failure in this stack was a test pinning
  // one OS's incidental behaviour. This matrix asserts the property instead:
  // wherever a dependency can be missing, the user gets *something* actionable.
  for (const [name, install] of Object.entries(INSTALLS)) {
    for (const platform of ["darwin", "win32"] as const) {
      test(`${name} resolves an instruction on ${platform}`, () => {
        const command = resolveInstallCommand(install, { platform, which: () => null });
        expect(command, `${name} has no answer on ${platform}`).not.toBeNull();
        expect((command as string).length).toBeGreaterThan(0);
      });
    }

    for (const [host, manager] of LINUX_HOSTS) {
      test(`${name} resolves an instruction on linux/${host}`, () => {
        const command = resolveInstallCommand(install, {
          platform: "linux",
          which: (candidate) => (manager && candidate === manager ? `/usr/bin/${candidate}` : null),
        });
        expect(command, `${name} has no answer on linux/${host}`).not.toBeNull();
        expect((command as string).length).toBeGreaterThan(0);
      });
    }
  }

  test("a resolved command never leaks another platform's package manager", () => {
    const command = resolveInstallCommand(MPV_INSTALL, {
      platform: "linux",
      which: (candidate) => (candidate === "pacman" ? "/usr/bin/pacman" : null),
    });
    expect(command).toBe("sudo pacman -S mpv");
    expect(command).not.toContain("apt");
    expect(command).not.toContain("brew");
  });
});

describe("buildDependencyRows", () => {
  test("names ffmpeg, not ffprobe", async () => {
    // No platform ships a package called ffprobe — it arrives inside ffmpeg —
    // so telling a user to install ffprobe is unactionable everywhere.
    const rows = buildDependencyRows(await bareSnapshot());
    expect(rows.map((row) => row.name)).toContain("ffmpeg");
    expect(rows.map((row) => row.name)).not.toContain("ffprobe");
  });

  test("explains the consequence rather than only the absence", async () => {
    const rows = buildDependencyRows(await bareSnapshot());
    const ffmpeg = rows.find((row) => row.id === "ffmpeg");
    expect(ffmpeg?.consequence).toContain("merge");
    const mpv = rows.find((row) => row.id === "mpv");
    expect(mpv?.consequence).toContain("Nothing can play");
  });

  test("distinguishes plain curl from an impersonate build", async () => {
    const plain = await probeCapabilities({
      which: (command) => (command === "curl" ? "/usr/bin/curl" : null),
      listPathEntries: () => ["curl"],
    });
    const row = buildDependencyRows(plain).find((r) => r.id === "curl-impersonate");
    expect(row?.state).toBe("degraded");
    expect(row?.detail).toBe("only plain curl");

    const impersonating = await probeCapabilities({
      which: (command) => `/usr/bin/${command}`,
      listPathEntries: () => ["curl", "curl_chrome150"],
    });
    const ok = buildDependencyRows(impersonating).find((r) => r.id === "curl-impersonate");
    expect(ok?.state).toBe("ok");
    expect(ok?.detail).toBe("matching chrome150");
  });

  test("mpv degrades rather than blocks", async () => {
    // Browsing, the watchlist, and the calendar all work without mpv. Calling
    // it blocking would be a lie about what is actually broken.
    const rows = buildDependencyRows(await bareSnapshot());
    expect(rows.find((row) => row.id === "mpv")?.state).toBe("degraded");
  });
});

describe("selectStartupIssueRows", () => {
  test("raises mpv in every mode", async () => {
    const rows = buildDependencyRows(await bareSnapshot());
    for (const mode of ["series", "anime", "youtube"] as const) {
      const selected = selectStartupIssueRows(rows, { mode, downloadsEnabled: false });
      expect(selected.map((row) => row.id)).toContain("mpv");
    }
  });

  test("does not mention curl-impersonate outside anime mode", async () => {
    // A blanket warning list is what makes people stop reading warnings.
    const rows = buildDependencyRows(await bareSnapshot());
    const series = selectStartupIssueRows(rows, { mode: "series", downloadsEnabled: false });
    expect(series.map((row) => row.id)).not.toContain("curl-impersonate");

    const anime = selectStartupIssueRows(rows, { mode: "anime", downloadsEnabled: false });
    expect(anime.map((row) => row.id)).toContain("curl-impersonate");
  });

  test("only mentions ffmpeg and yt-dlp when downloads or YouTube are in play", async () => {
    const rows = buildDependencyRows(await bareSnapshot());
    const quiet = selectStartupIssueRows(rows, { mode: "series", downloadsEnabled: false });
    expect(quiet.map((row) => row.id)).not.toContain("ffmpeg");
    expect(quiet.map((row) => row.id)).not.toContain("yt-dlp");

    const downloading = selectStartupIssueRows(rows, { mode: "series", downloadsEnabled: true });
    expect(downloading.map((row) => row.id)).toContain("ffmpeg");
  });

  test("never raises something the user cannot act on", async () => {
    // Posters degrading is a property of the terminal, not a mistake, and there
    // is no command that fixes it.
    const rows = buildDependencyRows(await bareSnapshot());
    const selected = selectStartupIssueRows(rows, { mode: "anime", downloadsEnabled: true });
    expect(selected.map((row) => row.id)).not.toContain("posters");
    for (const row of selected) expect(row.fix).not.toBeNull();
  });

  test("says nothing at all on a healthy machine", async () => {
    const healthy = await probeCapabilities({
      which: (command) => `/usr/bin/${command}`,
      listPathEntries: () => ["curl", "curl_chrome150"],
    });
    const selected = selectStartupIssueRows(buildDependencyRows(healthy), {
      mode: "anime",
      downloadsEnabled: true,
    });
    expect(selected).toEqual([]);
  });
});
