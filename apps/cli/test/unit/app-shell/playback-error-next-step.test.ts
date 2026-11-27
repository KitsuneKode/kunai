import { describe, expect, test } from "bun:test";

import { buildErrorNextStep } from "@/app-shell/playback-error-next-step";
import { buildErrorRows, rowText } from "@/app-shell/playback-error-rows";
import type { PlaybackProblem } from "@/domain/playback/playback-problem";

function problem(cause: string): PlaybackProblem {
  return {
    stage: "provider-resolve",
    severity: "blocking",
    cause,
    userMessage: cause,
    recommendedAction: "diagnostics",
    secondaryActions: [],
  };
}

const KEYS = { canRetry: true, canPickProvider: true };
const COMMANDS = {
  player: "sudo pacman -S mpv",
  ytDlp: "sudo pacman -S yt-dlp",
  curlImpersonate: "sudo pacman -S curl-impersonate",
};

describe("the next step a failed playback names", () => {
  test("a dead source sends the user to another one", () => {
    expect(buildErrorNextStep({ problem: problem("no-stream"), ...KEYS }).text).toBe(
      "press p and pick another source",
    );
  });

  test("a missing connection is not answered with a source picker", () => {
    for (const cause of ["network", "network-offline"]) {
      const next = buildErrorNextStep({ problem: problem(cause), ...KEYS });
      expect(next.text).toBe("check your connection, then press r to try again");
      expect(next.text).not.toContain("press p");
    }
  });

  test("a browser challenge gives the way out, then the permanent fix for this machine", () => {
    const next = buildErrorNextStep({
      problem: problem("provider-access"),
      ...KEYS,
      commands: COMMANDS,
      curlImpersonates: false,
    });
    expect(next.text).toBe("press p and pick another source");
    expect(next.extra).toEqual([
      { kind: "note", text: "To fix it for good, install curl-impersonate:" },
      { kind: "command", text: "sudo pacman -S curl-impersonate" },
    ]);
  });

  test("the install hint is withheld from a machine that already has it", () => {
    const next = buildErrorNextStep({
      problem: problem("provider-access"),
      ...KEYS,
      commands: COMMANDS,
      curlImpersonates: true,
    });
    expect(next.extra).toEqual([]);
  });

  test.each([
    ["mpv-missing", "mpv", "sudo pacman -S mpv"],
    ["vlc-missing", "VLC", "sudo pacman -S vlc vlc-plugin-ffmpeg"],
  ])("%s names the selected player and its command", (cause, name, player) => {
    const next = buildErrorNextStep({ problem: problem(cause), ...KEYS, commands: { player } });
    expect(next.text).toBe(`install ${name}, then press r`);
    expect(next.extra).toEqual([{ kind: "command", text: player }]);
  });

  test("an expired stream is a retry, not a new source", () => {
    expect(buildErrorNextStep({ problem: problem("expired-stream"), ...KEYS }).text).toBe(
      "press r — Kunai fetches a fresh stream",
    );
  });

  test("nothing known still names a key", () => {
    expect(buildErrorNextStep({ problem: null, ...KEYS }).text).toBe(
      "press r to try again, or p to pick another source",
    );
  });

  test("it never names a key the panel does not have", () => {
    const noPicker = buildErrorNextStep({
      problem: problem("no-stream"),
      canRetry: true,
      canPickProvider: false,
    });
    expect(noPicker.text).toBe("press r to try again");
    const noKeys = buildErrorNextStep({
      problem: null,
      canRetry: false,
      canPickProvider: false,
    });
    expect(noKeys.text).not.toMatch(/press [rp]\b/u);
    expect(noKeys.text).toBe("press Enter to go back and try again");
  });
});

describe("the panel puts the next step between the cause and the evidence", () => {
  test("order is cause, Next, attempts, keys", () => {
    const rows = buildErrorRows({
      message: "The stream did not start.",
      nextStep: {
        text: "press p and pick another source",
        extra: [
          { kind: "note", text: "To fix it for good, install curl-impersonate:" },
          { kind: "command", text: "sudo pacman -S curl-impersonate" },
        ],
      },
      waterfall: {
        title: "Provider attempts",
        truncated: false,
        rows: [{ label: "hianime", detail: "blocked", status: "failed" }],
      },
      canRetry: true,
      textWidth: 70,
    }).map(rowText);
    expect(rows).toEqual([
      "Playback failed",
      "The stream did not start.",
      "",
      "Next  press p and pick another source",
      "      To fix it for good, install curl-impersonate:",
      "      sudo pacman -S curl-impersonate",
      "",
      "Provider attempts",
      "x hianime  ·  blocked",
      "",
      "r retry  ·  Enter / Esc dismiss",
    ]);
  });

  test("a long instruction wraps under itself instead of clipping at the panel edge", () => {
    const rows = buildErrorRows({
      message: "x",
      nextStep: { text: "press r to try again, or p to pick another source", extra: [] },
      canRetry: true,
      textWidth: 34,
    }).map(rowText);
    const next = rows.filter((row) => row.startsWith("Next") || row.startsWith("      "));
    expect(next.length).toBeGreaterThan(1);
    for (const row of next) expect(row.length).toBeLessThanOrEqual(34);
    expect(next.join(" ").replace(/\s+/gu, " ")).toContain(
      "press r to try again, or p to pick another source",
    );
  });
});
