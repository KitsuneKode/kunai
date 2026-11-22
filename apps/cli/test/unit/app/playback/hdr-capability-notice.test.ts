import { describe, expect, test } from "bun:test";

import {
  describeHdrCapabilityGap,
  resolveHdrCapabilityNotice,
} from "@/app/playback/hdr-capability-notice";
import type { StreamInfo } from "@/domain/types";

const legacy = { supportsGpuNext: false, probed: true };
const modern = { supportsGpuNext: true, probed: true };
const unknown = { supportsGpuNext: false, probed: false };

function streamWith(dynamicRange: "sdr" | "hdr10" | "dolby-vision"): StreamInfo {
  // SAFETY: deliberately partial test stub — only the selected candidate's dynamicRange is read.
  return {
    url: "https://cdn.example.test/master.m3u8",
    providerResolveResult: {
      selectedStreamId: "s1",
      streams: [{ id: "s1", dynamicRange }],
    },
  } as never;
}

describe("HDR capability notice", () => {
  test("warns about Dolby Vision and passthrough only when mpv lacks gpu-next", () => {
    expect(
      describeHdrCapabilityGap({
        hdrMode: "auto",
        dynamicRange: "dolby-vision",
        capability: legacy,
      }),
    ).toContain("Dolby Vision");
    expect(
      describeHdrCapabilityGap({
        hdrMode: "passthrough",
        dynamicRange: "hdr10",
        capability: legacy,
      }),
    ).toContain("passthrough");
    expect(
      describeHdrCapabilityGap({
        hdrMode: "passthrough",
        dynamicRange: "hdr10",
        capability: modern,
      }),
    ).toBeNull();
    expect(
      describeHdrCapabilityGap({ hdrMode: "auto", dynamicRange: "hdr10", capability: legacy }),
    ).toBeNull();
  });

  test("an unfinished probe is not evidence of a gap", () => {
    expect(
      describeHdrCapabilityGap({
        hdrMode: "passthrough",
        dynamicRange: "dolby-vision",
        capability: unknown,
      }),
    ).toBeNull();
  });

  test("probes only when a notice is possible", async () => {
    let probes = 0;
    const probe = async () => {
      probes += 1;
      return legacy;
    };
    expect(await resolveHdrCapabilityNotice(streamWith("hdr10"), "auto", probe)).toBeNull();
    expect(await resolveHdrCapabilityNotice(streamWith("sdr"), "tone-map", probe)).toBeNull();
    expect(probes).toBe(0);

    expect(await resolveHdrCapabilityNotice(streamWith("dolby-vision"), "auto", probe)).toContain(
      "Dolby Vision",
    );
    expect(await resolveHdrCapabilityNotice(streamWith("sdr"), "passthrough", probe)).toContain(
      "passthrough",
    );
    expect(probes).toBe(2);
  });
});
