import type { StreamInfo } from "@/domain/types";
import { discoverMpvInvocation } from "@/infra/player/mpv-discovery";
import { probeMpvHdrCapability, type MpvHdrCapability } from "@/infra/player/mpv-hdr";
import type { HdrMode } from "@kunai/config";
import type { VideoDynamicRange } from "@kunai/types";

export interface HdrCapabilityGapInput {
  readonly hdrMode: HdrMode;
  readonly dynamicRange: VideoDynamicRange | undefined;
  readonly capability: MpvHdrCapability;
}

/**
 * Tell the user when what they asked for cannot happen on this mpv, instead of
 * silently degrading:
 * - `passthrough` without gpu-next sends no HDR signal, so output is SDR.
 * - Dolby Vision without gpu-next (libplacebo) cannot apply the DV reshaping;
 *   profile 5 then plays with purple/green colours.
 *
 * Silent when the probe did not complete: an unknown capability is not
 * evidence of a gap.
 */
export function describeHdrCapabilityGap(input: HdrCapabilityGapInput): string | null {
  if (!input.capability.probed || input.capability.supportsGpuNext) return null;
  if (input.dynamicRange === "dolby-vision") {
    return "Dolby Vision needs mpv with gpu-next (libplacebo); colours may look wrong. Update mpv or pick another source.";
  }
  if (input.hdrMode === "passthrough") {
    return "HDR passthrough needs mpv with gpu-next (libplacebo); playing as SDR.";
  }
  return null;
}

function selectedDynamicRange(stream: StreamInfo): VideoDynamicRange | undefined {
  const result = stream.providerResolveResult;
  return result?.streams.find((candidate) => candidate.id === result.selectedStreamId)
    ?.dynamicRange;
}

/**
 * Probes only when a notice is possible (passthrough, or a Dolby Vision
 * stream); the probe result is cached once it completes, so later episodes
 * cost nothing.
 */
export async function resolveHdrCapabilityNotice(
  stream: StreamInfo,
  hdrMode: HdrMode,
  probe: (
    invocation: ReturnType<typeof discoverMpvInvocation>,
  ) => Promise<MpvHdrCapability> = probeMpvHdrCapability,
): Promise<string | null> {
  const dynamicRange = selectedDynamicRange(stream);
  if (hdrMode !== "passthrough" && dynamicRange !== "dolby-vision") return null;
  const capability = await probe(discoverMpvInvocation());
  return describeHdrCapabilityGap({ hdrMode, dynamicRange, capability });
}
