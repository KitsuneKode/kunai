import type { ProviderFetchPort, StreamCandidate } from "@kunai/types";

import { expandHlsMasterInventory, isHlsDeadHostStatus } from "../shared/hls-ladder";

/**
 * A lightweight utility to fetch a master HLS playlist and split it into explicitly
 * ranked StreamCandidate variants based on resolution. This pushes quality
 * selection to the CLI/UI rather than leaving it to the video player's default behavior.
 */
export async function extractQualitiesFromMaster(
  fetchPort: ProviderFetchPort,
  masterUrl: string,
  baseStreamTemplate: Omit<StreamCandidate, "id" | "url" | "qualityLabel" | "qualityRank">,
  headers?: Record<string, string>,
): Promise<StreamCandidate[]> {
  const inventory = await expandHlsMasterInventory({
    fetch: fetchPort.fetch.bind(fetchPort),
    masterUrl,
    headers,
  });
  const variants = isHlsDeadHostStatus(inventory.probe.httpStatus) ? [] : inventory.variants;

  return variants.map((variant) => ({
    ...baseStreamTemplate,
    id: `stream_${Buffer.from(variant.url).toString("base64url").substring(0, 10)}`,
    url: variant.url,
    qualityLabel: variant.qualityLabel,
    qualityRank: variant.qualityRank,
  }));
}
