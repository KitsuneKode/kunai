import { afterEach, describe, expect, test } from "bun:test";

import {
  clearMpvHdrCapabilityCache,
  formatDynamicRangeBadge,
  parseMpvVoHelpSupportsGpuNext,
  probeMpvHdrCapability,
  resolveMpvHdrArgs,
} from "@/infra/player/mpv-hdr";
import { buildMpvArgs } from "@/mpv";

afterEach(() => {
  clearMpvHdrCapabilityCache();
});

describe("mpv HDR capability probing & argument resolution", () => {
  test("parses gpu-next availability from mpv --vo=help output", () => {
    const modernHelp = [
      "Available video outputs:",
      "  libmpv           render API for libmpv",
      "  gpu              Shader-based GPU Renderer",
      "  gpu-next         Video output based on libplacebo",
      "  null             Null video output",
    ].join("\n");
    const legacyHelp = [
      "Available video outputs:",
      "  gpu              Shader-based GPU Renderer",
      "  x11              X11 (software scaling)",
    ].join("\n");

    expect(parseMpvVoHelpSupportsGpuNext(modernHelp)).toBe(true);
    expect(parseMpvVoHelpSupportsGpuNext(legacyHelp)).toBe(false);
  });

  test("probeMpvHdrCapability fails closed on missing binary or non-zero exit", async () => {
    expect(await probeMpvHdrCapability(null)).toEqual({ supportsGpuNext: false, probed: false });

    const failed = await probeMpvHdrCapability(
      { argv: ["mpv"], via: "path" },
      { runHelp: async () => ({ ok: false, stdout: "gpu-next" }) },
    );
    expect(failed).toEqual({ supportsGpuNext: false, probed: false });

    const supported = await probeMpvHdrCapability(
      { argv: ["mpv"], via: "path" },
      { runHelp: async () => ({ ok: true, stdout: "  gpu-next         libplacebo\n" }) },
    );
    expect(supported).toEqual({ supportsGpuNext: true, probed: true });
  });

  test("auto mode stays silent for SDR/unknown streams and activates safe peak tone-mapping on HDR/DV", () => {
    expect(resolveMpvHdrArgs({ hdrMode: "auto", supportsGpuNext: true })).toEqual([]);
    expect(
      resolveMpvHdrArgs({ hdrMode: "auto", streamDynamicRange: "sdr", supportsGpuNext: true }),
    ).toEqual([]);
    expect(
      resolveMpvHdrArgs({ hdrMode: "auto", streamDynamicRange: "hdr10", supportsGpuNext: true }),
    ).toEqual(["--vo=gpu-next", "--tone-mapping=auto", "--hdr-compute-peak=yes"]);
    expect(
      resolveMpvHdrArgs({
        hdrMode: "auto",
        streamDynamicRange: "dolby-vision",
        supportsGpuNext: false,
      }),
    ).toEqual(["--tone-mapping=auto", "--hdr-compute-peak=yes"]);
  });

  test("passthrough, tone-map, and sdr-only gate gpu-next-only flags behind supportsGpuNext", () => {
    expect(resolveMpvHdrArgs({ hdrMode: "passthrough", supportsGpuNext: true })).toEqual([
      "--vo=gpu-next",
      "--target-colorspace-hint=yes",
      "--hdr-compute-peak=yes",
    ]);
    expect(resolveMpvHdrArgs({ hdrMode: "passthrough", supportsGpuNext: false })).toEqual([
      "--hdr-compute-peak=yes",
    ]);

    expect(resolveMpvHdrArgs({ hdrMode: "tone-map", supportsGpuNext: true })).toEqual([
      "--vo=gpu-next",
      "--tone-mapping=bt.2446a",
      "--hdr-compute-peak=yes",
      "--gamut-mapping-mode=perceptual",
    ]);
    expect(resolveMpvHdrArgs({ hdrMode: "tone-map", supportsGpuNext: false })).toEqual([
      "--tone-mapping=bt.2446a",
      "--hdr-compute-peak=yes",
    ]);

    expect(resolveMpvHdrArgs({ hdrMode: "sdr-only", supportsGpuNext: true })).toEqual([
      "--target-colorspace-hint=no",
      "--tone-mapping=bt.2446a",
    ]);
    expect(resolveMpvHdrArgs({ hdrMode: "sdr-only", supportsGpuNext: false })).toEqual([
      "--tone-mapping=bt.2446a",
    ]);
  });

  test("buildMpvArgs appends HDR flags when configured and stays quiet for default SDR", () => {
    const baseOpts = {
      url: "https://cdn.example.test/video.m3u8",
      headers: {},
      subtitle: null,
      displayTitle: "Dune",
    };

    const sdrArgs = buildMpvArgs(baseOpts, null, {
      mpv: { hdrMode: "auto", supportsGpuNext: true },
    });
    expect(sdrArgs).not.toContain("--vo=gpu-next");
    expect(sdrArgs).not.toContain("--target-colorspace-hint=yes");

    const hdrArgs = buildMpvArgs({ ...baseOpts, dynamicRange: "dolby-vision" }, null, {
      mpv: { hdrMode: "passthrough", supportsGpuNext: true },
    });
    expect(hdrArgs).toContain("--vo=gpu-next");
    expect(hdrArgs).toContain("--target-colorspace-hint=yes");
    expect(hdrArgs).toContain("--hdr-compute-peak=yes");
  });

  test("formatDynamicRangeBadge emits concise HDR badges and omits SDR", () => {
    expect(formatDynamicRangeBadge("dolby-vision")).toBe("DV");
    expect(formatDynamicRangeBadge("hdr10")).toBe("HDR10");
    expect(formatDynamicRangeBadge("hlg")).toBe("HLG");
    expect(formatDynamicRangeBadge("sdr")).toBeUndefined();
    expect(formatDynamicRangeBadge(undefined)).toBeUndefined();
  });
});
