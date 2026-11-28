import { describe, expect, test } from "bun:test";

import { failoverBannerCopy } from "@/app-shell/primitives/FailoverBanner.model";
import {
  buildPlaybackFailoverNotice,
  playbackSourceDisplayLabel,
  providerDisplayName,
} from "@/app/playback/playback-failover-copy";

describe("playback failover copy", () => {
  test("a raw source id never becomes the banner label", () => {
    expect(
      playbackSourceDisplayLabel({
        sourceId: "src:vidking:deadbeef",
        inventory: {
          sources: [{ id: "src:vidking:deadbeef", label: "src:vidking:deadbeef" }],
        },
        providerName: "VidKing",
      }),
    ).toBe("VidKing");
    expect(
      playbackSourceDisplayLabel({
        sourceId: "src:rivestream:1",
        inventory: {
          sources: [{ id: "src:rivestream:1", label: "Rivestream" }],
        },
        providerName: "VidKing",
      }),
    ).toBe("Rivestream");
  });

  test("startup keeps no timestamp and mid-stream keeps the trusted position", () => {
    const startup = buildPlaybackFailoverNotice({
      phase: "startup",
      fromLabel: "VidKing",
      toLabel: "Rivestream",
      preservedSeconds: 862,
    });
    expect(startup.preservedSeconds).toBeNull();
    expect(startup.tone).toBe("warn");

    const mid = buildPlaybackFailoverNotice({
      phase: "mid-stream",
      fromLabel: providerDisplayName("VidKing"),
      toLabel: "Rivestream",
      preservedSeconds: 862,
    });
    expect(mid).toMatchObject({
      phase: "mid-stream",
      fromLabel: "VidKing",
      toLabel: "Rivestream",
      preservedSeconds: 862,
      tone: "warn",
    });
    expect(failoverBannerCopy(mid)).toEqual({
      headline: "Switching from VidKing to Rivestream",
      detail: "Holding position at 14:22",
    });
  });

  test("no named alternative is an error and does not invent a destination", () => {
    const notice = buildPlaybackFailoverNotice({
      phase: "mid-stream",
      fromLabel: "VidKing",
      toLabel: "VidKing",
      preservedSeconds: 10,
    });
    expect(notice.toLabel).toBeNull();
    expect(notice.tone).toBe("error");
  });
});
