import { afterEach, describe, expect, test } from "bun:test";

import { HDR_MODE_OPTIONS } from "@/app-shell/settings/registry/shared";
import { buildCliHelpText, CliUsageError, parseCliArgs } from "@/cli-args";
import {
  clearMpvHdrCapabilityCache,
  formatDynamicRangeBadge,
  parseMpvVoHelpSupportsGpuNext,
  probeMpvHdrCapability,
  resolveMpvHdrArgs,
} from "@/infra/player/mpv-hdr";
import { buildMpvArgs } from "@/mpv";
import { HDR_MODES } from "@kunai/config";

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

  test("a failed or timed-out probe is retried; a completed probe is cached", async () => {
    const cache = new Map();
    const invocation = { argv: ["flatpak", "run", "io.mpv.Mpv"], via: "flatpak" } as const;
    let calls = 0;
    let next = { ok: false, stdout: "" };
    const runHelp = async () => {
      calls += 1;
      return next;
    };

    // Cold start timed out: must not pin gpu-next off for the rest of the process.
    expect(await probeMpvHdrCapability(invocation, { runHelp, cache })).toEqual({
      supportsGpuNext: false,
      probed: false,
    });
    expect(cache.size).toBe(0);

    next = { ok: true, stdout: "  gpu-next         libplacebo\n" };
    expect((await probeMpvHdrCapability(invocation, { runHelp, cache })).supportsGpuNext).toBe(
      true,
    );
    expect(await probeMpvHdrCapability(invocation, { runHelp, cache })).toEqual({
      supportsGpuNext: true,
      probed: true,
    });
    expect(calls).toBe(2);
  });

  test("auto never emits HDR options, so mpv.conf vo and a reused mpv stay untouched", () => {
    expect(resolveMpvHdrArgs({ hdrMode: "auto", supportsGpuNext: true })).toEqual([]);
    expect(resolveMpvHdrArgs({ hdrMode: "auto", supportsGpuNext: false })).toEqual([]);
    expect(resolveMpvHdrArgs({ supportsGpuNext: true })).toEqual([]);
  });

  test("explicit modes use libplacebo options only with gpu-next", () => {
    expect(resolveMpvHdrArgs({ hdrMode: "passthrough", supportsGpuNext: true })).toEqual([
      "--vo=gpu-next",
      "--target-colorspace-hint=yes",
      "--hdr-compute-peak=yes",
    ]);
    expect(resolveMpvHdrArgs({ hdrMode: "passthrough", supportsGpuNext: false })).toEqual([
      "--hdr-compute-peak=yes",
    ]);
    for (const hdrMode of ["tone-map", "sdr-only"] as const) {
      expect(resolveMpvHdrArgs({ hdrMode, supportsGpuNext: true })).toEqual([
        "--vo=gpu-next",
        "--target-colorspace-hint=no",
        "--target-prim=bt.709",
        "--target-trc=bt.1886",
        "--tone-mapping=bt.2446a",
        "--hdr-compute-peak=yes",
      ]);
    }
  });

  test("SDR modes pin an SDR target so an mpv.conf target-trc=pq cannot keep HDR output", () => {
    // CLI options override mpv.conf, so an explicit SDR target beats a
    // configured PQ target on both gpu-next and legacy mpv.
    for (const hdrMode of ["tone-map", "sdr-only"] as const) {
      for (const supportsGpuNext of [true, false]) {
        const args = resolveMpvHdrArgs({ hdrMode, supportsGpuNext });
        expect(args).toContain("--target-trc=bt.1886");
        expect(args).toContain("--target-prim=bt.709");
      }
    }
  });

  test("legacy mpv (no gpu-next) gets no libplacebo-only option or value", () => {
    // An unknown --tone-mapping value is a fatal option error on old mpv, and
    // --gamut-mapping-mode=perceptual is unknown to 0.35 — either aborts launch.
    const libplaceboOnly = [
      "--vo=gpu-next",
      "--target-colorspace-hint",
      "--tone-mapping",
      "--gamut-mapping-mode",
    ];
    for (const hdrMode of ["auto", "passthrough", "tone-map", "sdr-only"] as const) {
      const legacy = resolveMpvHdrArgs({ hdrMode, supportsGpuNext: false });
      for (const arg of legacy) {
        expect(libplaceboOnly.some((prefix) => arg.startsWith(prefix))).toBe(false);
      }
      const modern = resolveMpvHdrArgs({ hdrMode, supportsGpuNext: true });
      expect(modern.some((arg) => arg.startsWith("--gamut-mapping-mode"))).toBe(false);
    }
  });

  test("buildMpvArgs appends HDR flags for an explicit mode and stays quiet in auto", () => {
    const baseOpts = {
      url: "https://cdn.example.test/video.m3u8",
      headers: {},
      subtitle: null,
      displayTitle: "Dune",
    };

    const autoArgs = buildMpvArgs(baseOpts, null, {
      mpv: { hdrMode: "auto", supportsGpuNext: true },
    });
    expect(autoArgs.some((arg) => arg.startsWith("--vo="))).toBe(false);
    expect(autoArgs.some((arg) => arg.startsWith("--tone-mapping"))).toBe(false);

    const hdrArgs = buildMpvArgs(baseOpts, null, {
      mpv: { hdrMode: "passthrough", supportsGpuNext: true },
    });
    expect(hdrArgs).toContain("--vo=gpu-next");
    expect(hdrArgs).toContain("--target-colorspace-hint=yes");
    expect(hdrArgs).toContain("--hdr-compute-peak=yes");
  });

  test("--hdr parses every mode case-insensitively and rejects anything else", () => {
    for (const mode of HDR_MODES) {
      expect(parseCliArgs(["--hdr", mode.toUpperCase()]).hdr).toBe(mode);
    }
    expect(parseCliArgs([]).hdr).toBeUndefined();
    expect(() => parseCliArgs(["--hdr", "bogus"])).toThrow(CliUsageError);
  });

  test("--help lists exactly the modes config accepts", () => {
    // The help line is plain text on purpose: the docs generator parses it from
    // source, so it cannot interpolate HDR_MODES. This test keeps them in step.
    const line = buildCliHelpText("0.0.0")
      .split("\n")
      .find((row) => row.includes("--hdr <mode>"));
    expect(
      line
        ?.split("HDR mode:")[1]
        ?.split("|")
        .map((mode) => mode.trim()),
    ).toEqual([...HDR_MODES]);
  });

  test("the settings row offers exactly the modes config accepts", () => {
    expect(HDR_MODE_OPTIONS.map((option) => option.value)).toEqual([...HDR_MODES]);
  });

  test("formatDynamicRangeBadge emits concise HDR badges and omits SDR", () => {
    expect(formatDynamicRangeBadge("dolby-vision")).toBe("DV");
    expect(formatDynamicRangeBadge("hdr10")).toBe("HDR10");
    expect(formatDynamicRangeBadge("hlg")).toBe("HLG");
    expect(formatDynamicRangeBadge("sdr")).toBeUndefined();
    expect(formatDynamicRangeBadge(undefined)).toBeUndefined();
  });
});
