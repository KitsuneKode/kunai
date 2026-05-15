import { describe, expect, test } from "bun:test";

import {
  getLoadingShellTimerPolicy,
  getProviderResolveWaitPresentation,
  normalizeLoadingIssue,
  normalizeProviderDetail,
  shouldShowLoadingElapsed,
} from "@/app-shell/loading-shell-runtime";
import {
  formatRuntimeMemory,
  parseProcStatus,
  summarizeChildProcessMemory,
} from "@/app-shell/runtime-memory";

describe("loading shell runtime policy", () => {
  test("active playback disables animation and elapsed repaint timers", () => {
    const policy = getLoadingShellTimerPolicy({
      operation: "playing",
      memoryPanelVisible: false,
    });

    expect(policy.animate).toBe(false);
    expect(policy.trackElapsed).toBe(false);
    expect(policy.memoryRefreshMs).toBeNull();
    expect(policy.runtimeHealthRefreshMs).toBeNull();
    expect(shouldShowLoadingElapsed("playing", 600)).toBe(false);
  });

  test("visible memory panel refreshes runtime panels while playback remains otherwise static", () => {
    const policy = getLoadingShellTimerPolicy({
      operation: "playing",
      memoryPanelVisible: true,
      runtimeHealthVisible: true,
    });

    expect(policy.animate).toBe(false);
    expect(policy.trackElapsed).toBe(false);
    expect(policy.memoryRefreshMs).toBe(2_000);
    expect(policy.runtimeHealthRefreshMs).toBe(2_000);
  });

  test("loading keeps short-lived animation and elapsed timers", () => {
    const policy = getLoadingShellTimerPolicy({
      operation: "loading",
      memoryPanelVisible: false,
    });

    expect(policy.animate).toBe(true);
    expect(policy.trackElapsed).toBe(true);
    expect(policy.memoryRefreshMs).toBeNull();
    expect(policy.runtimeHealthRefreshMs).toBeNull();
    expect(shouldShowLoadingElapsed("loading", 12)).toBe(true);
  });

  test("provider resolve copy becomes honest after a long wait and keeps fallback visible", () => {
    expect(
      getProviderResolveWaitPresentation({
        elapsedSeconds: 8,
        fallbackAvailable: true,
      }),
    ).toEqual({
      message: "Preparing playback context…",
      tone: "info",
      footerTask: "Playback bootstrap  ·  f fallback · q / Esc cancel",
    });

    // latestIssue takes priority over elapsed-based degradation
    expect(
      getProviderResolveWaitPresentation({
        elapsedSeconds: 36,
        fallbackAvailable: true,
        latestIssue: "vidking: CDN request timed out",
      }),
    ).toEqual({
      message: "Issue: vidking: CDN request timed out",
      tone: "warning",
      footerTask: "Playback bootstrap  ·  f fallback · q / Esc cancel",
    });

    // Without latestIssue, elapsed >= 20 triggers degradation hint
    expect(
      getProviderResolveWaitPresentation({
        elapsedSeconds: 25,
        fallbackAvailable: true,
      }),
    ).toEqual({
      message: "Provider/CDN may be degraded. Try fallback or open diagnostics.",
      tone: "warning",
      footerTask: "Provider/CDN degraded  ·  f fallback · Esc cancel · d diagnostics",
    });
  });

  test("loading copy does not promote subtitle-ready status into an issue", () => {
    expect(normalizeLoadingIssue("subtitle attached")).toBeNull();
    expect(
      getProviderResolveWaitPresentation({
        elapsedSeconds: 4,
        latestIssue: "subtitle attached",
        stageDetail: "Opening provider stream",
      }).message,
    ).toBe("Opening provider stream");
  });

  test("loading copy does not promote provider retry progress into an issue", () => {
    expect(
      normalizeLoadingIssue("Recoverable provider failures retry before fallback."),
    ).toBeNull();
    expect(
      getProviderResolveWaitPresentation({
        elapsedSeconds: 4,
        latestIssue: "Recoverable provider failures retry before fallback.",
        stageDetail: "Resolving via AllManga",
      }).message,
    ).toBe("Resolving via AllManga");
  });

  test("loading copy treats fallback progress as recovery, not final failure", () => {
    expect(
      normalizeLoadingIssue("VidKing had an issue. Trying Rivestream fallback now."),
    ).toBeNull();
    expect(
      getProviderResolveWaitPresentation({
        elapsedSeconds: 6,
        latestIssue: "VidKing had an issue. Trying Rivestream fallback now.",
        stageDetail: "Trying Rivestream fallback",
      }).message,
    ).toBe("Trying Rivestream fallback");
  });

  test("provider detail avoids duplicate Provider labels", () => {
    expect(normalizeProviderDetail("Provider: vidking · direct-http")).toBe(
      "vidking · direct-http",
    );
    expect(normalizeProviderDetail("vidking · direct-http")).toBe("vidking · direct-http");
  });
});

describe("runtime memory reporting", () => {
  test("parses Linux proc status memory fields", () => {
    const parsed = parseProcStatus(`Name:\tmpv
PPid:\t42
VmRSS:\t616180 kB
VmSwap:\t128 kB
`);

    expect(parsed).toEqual({
      name: "mpv",
      ppid: 42,
      rssBytes: 616_180 * 1024,
      swapBytes: 128 * 1024,
    });
  });

  test("summarizes mpv child memory and formats total playback memory", () => {
    const children = summarizeChildProcessMemory(
      [
        { name: "mpv", ppid: 100, rssBytes: 616_180 * 1024, swapBytes: 128 * 1024 },
        { name: "zsh", ppid: 100, rssBytes: 12_000 * 1024, swapBytes: 0 },
        { name: "mpv", ppid: 200, rssBytes: 999_999 * 1024, swapBytes: 0 },
      ],
      { parentPid: 100 },
    );

    expect(children).toEqual({
      rssBytes: 616_180 * 1024,
      swapBytes: 128 * 1024,
      count: 1,
    });

    expect(
      formatRuntimeMemory({
        appRssBytes: 10_260_132 * 1024,
        appHeapUsedBytes: 80 * 1024 * 1024,
        appHeapTotalBytes: 128 * 1024 * 1024,
        playbackChildRssBytes: children.rssBytes,
        playbackChildSwapBytes: children.swapBytes,
        playbackChildCount: children.count,
        appSwapBytes: 7_118_108 * 1024,
      }),
    ).toBe("App 9.8 GiB · mpv 601.7 MiB · total 10.4 GiB · heap 80.0/128.0 MiB · swap 6.8 GiB");
  });
});
