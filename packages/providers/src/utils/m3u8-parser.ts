import type { ProviderFetchPort, StreamCandidate } from "@kunai/types";

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
  try {
    const res = await fetchPort.fetch(masterUrl, {
      headers: headers || {},
    });

    if (!res.ok) {
      return [];
    }

    const text = await res.text();
    const lines = text.split("\n");

    const streams: StreamCandidate[] = [];
    let currentResolution = "";
    let currentBandwidth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]?.trim() ?? "";

      if (line.startsWith("#EXT-X-STREAM-INF:")) {
        // Extract RESOLUTION=1920x1080
        const resMatch = line.match(/RESOLUTION=\d+x(\d+)/);
        if (resMatch && resMatch[1]) {
          currentResolution = `${resMatch[1]}p`;
        }

        // Extract BANDWIDTH=12345
        const bwMatch = line.match(/BANDWIDTH=(\d+)/);
        if (bwMatch && bwMatch[1]) {
          currentBandwidth = parseInt(bwMatch[1], 10);
        }

        // Sometimes qualities are passed as NAME="1080p"
        const nameMatch = line.match(/NAME="([^"]+)"/);
        if (nameMatch && nameMatch[1]) {
          currentResolution = nameMatch[1];
        }
      } else if (line && !line.startsWith("#")) {
        // It's a URI line
        if (currentResolution) {
          const absoluteUrl = new URL(line, masterUrl).toString();

          streams.push({
            ...baseStreamTemplate,
            id: `stream_${Buffer.from(absoluteUrl).toString("base64url").substring(0, 10)}`,
            url: absoluteUrl,
            qualityLabel: currentResolution,
            qualityRank:
              parseInt(currentResolution.replace(/\D/g, ""), 10) || currentBandwidth || 0,
          });

          currentResolution = "";
          currentBandwidth = 0;
        }
      }
    }

    // Sort by rank descending
    streams.sort((a, b) => (b.qualityRank || 0) - (a.qualityRank || 0));

    // If we failed to parse specific qualities, just return the master
    if (streams.length === 0) {
      return [
        {
          ...baseStreamTemplate,
          id: `stream_master_${Buffer.from(masterUrl).toString("base64url").substring(0, 10)}`,
          url: masterUrl,
          qualityLabel: "Auto",
          qualityRank: 0,
        },
      ];
    }

    return streams;
  } catch {
    // If fetching fails due to CORS or other issues, return the master URL fallback
    return [
      {
        ...baseStreamTemplate,
        id: `stream_master_${Buffer.from(masterUrl).toString("base64url").substring(0, 10)}`,
        url: masterUrl,
        qualityLabel: "Auto",
        qualityRank: 0,
      },
    ];
  }
}
