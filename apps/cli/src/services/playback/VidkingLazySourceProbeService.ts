import {
  getVidkingFlavor,
  listPhaseBLazyProbeFlavorIds,
  resolveFlavorEngineOptions,
  resolveVidkingDirect,
  VIDKING_PROVIDER_ID,
  vidkingSourceIdForEndpoint,
} from "@kunai/providers";
import type {
  ProviderResolveInput,
  ProviderResolveResult,
  ProviderRuntimeContext,
  ProviderSourceCandidate,
} from "@kunai/types";

import type { SourceInventoryService } from "./SourceInventoryService";
import type { SourceInventoryCacheInput } from "./SourceInventoryService";

const PROBE_CONCURRENCY = 2;

export class VidkingLazySourceProbeService {
  constructor(
    private readonly options: {
      readonly sourceInventory?: Pick<SourceInventoryService, "set" | "get">;
    } = {},
  ) {}

  schedulePhaseB(input: {
    readonly resolveInput: ProviderResolveInput;
    readonly context: ProviderRuntimeContext;
    readonly baseResult: ProviderResolveResult;
    readonly inventoryKey: SourceInventoryCacheInput;
    readonly preferredAudioLanguage?: string;
    readonly onInventoryUpdated?: (result: ProviderResolveResult) => void;
  }): void {
    if (input.baseResult.providerId !== VIDKING_PROVIDER_ID) return;
    void this.runPhaseB(input).catch(() => {
      // Background probes are best-effort.
    });
  }

  private async runPhaseB(input: {
    readonly resolveInput: ProviderResolveInput;
    readonly context: ProviderRuntimeContext;
    readonly baseResult: ProviderResolveResult;
    readonly inventoryKey: SourceInventoryCacheInput;
    readonly preferredAudioLanguage?: string;
    readonly onInventoryUpdated?: (result: ProviderResolveResult) => void;
  }): Promise<void> {
    const flavorIds = listPhaseBLazyProbeFlavorIds(input.preferredAudioLanguage);
    if (flavorIds.length === 0) return;

    let merged = input.baseResult;
    const markProbing = (flavorId: string): ProviderResolveResult => {
      const flavor = getVidkingFlavor(flavorId);
      const options = resolveFlavorEngineOptions(flavorId);
      const endpoint = flavor?.endpoint ?? options?.serverEndpoint ?? flavorId;
      const probingSource: ProviderSourceCandidate = {
        id: vidkingSourceIdForEndpoint(endpoint),
        providerId: VIDKING_PROVIDER_ID,
        kind: "provider-api",
        label: flavor?.themeLabel ?? options?.flavorLabel ?? endpoint,
        host: "api.videasy.net",
        status: "probing",
        confidence: 0.5,
        cachePolicy: merged.cachePolicy,
        metadata: {
          server: endpoint,
          flavorId,
          flavorArchetype: flavor?.subtitle ?? options?.flavorArchetype,
          phase: "B",
        },
      };
      return mergeInventorySources(merged, [probingSource], merged.streams, merged.subtitles);
    };

    let cursor = 0;
    const workers = Array.from({ length: PROBE_CONCURRENCY }, async () => {
      while (cursor < flavorIds.length) {
        if (input.context.signal?.aborted) return;
        const flavorId = flavorIds[cursor];
        if (!flavorId) break;
        cursor += 1;
        merged = markProbing(flavorId);
        input.onInventoryUpdated?.(merged);
        await this.persistInventory(input.inventoryKey, merged);

        const flavor = getVidkingFlavor(flavorId);
        const engineOptions = resolveFlavorEngineOptions(flavorId);
        if (!engineOptions) continue;

        const endpoint = flavor?.endpoint ?? engineOptions.serverEndpoint ?? flavorId;
        const sourceId = vidkingSourceIdForEndpoint(endpoint);
        const themeLabel = flavor?.themeLabel ?? engineOptions.flavorLabel ?? endpoint;
        let probeSources: readonly ProviderSourceCandidate[];
        let probeStreams = merged.streams;
        let probeSubtitles = merged.subtitles;

        try {
          const probeResult = await resolveVidkingDirect(
            input.resolveInput,
            input.context,
            engineOptions,
          );
          if (probeResult?.streams.length) {
            probeSources = probeResult.sources ?? [];
            probeStreams = [...merged.streams, ...probeResult.streams];
            probeSubtitles = [...merged.subtitles, ...probeResult.subtitles];
          } else {
            probeSources = [
              failedSource(
                sourceId,
                themeLabel,
                flavor?.subtitle ?? engineOptions.flavorArchetype,
                flavorId,
                endpoint,
                "no-streams",
              ),
            ];
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          probeSources = [
            failedSource(
              sourceId,
              themeLabel,
              flavor?.subtitle ?? engineOptions.flavorArchetype,
              flavorId,
              endpoint,
              message,
            ),
          ];
        }

        merged = mergeInventorySources(merged, probeSources, probeStreams, probeSubtitles);
        input.onInventoryUpdated?.(merged);
        await this.persistInventory(input.inventoryKey, merged);
      }
    });

    await Promise.all(workers);
  }

  private async persistInventory(
    key: SourceInventoryCacheInput,
    inventory: ProviderResolveResult,
  ): Promise<void> {
    await this.options.sourceInventory?.set(key, inventory);
  }
}

function failedSource(
  sourceId: string,
  label: string,
  subtitle: string | undefined,
  flavorId: string,
  endpoint: string,
  reason: string,
): ProviderSourceCandidate {
  return {
    id: sourceId,
    providerId: VIDKING_PROVIDER_ID,
    kind: "provider-api",
    label,
    host: "api.videasy.net",
    status: "failed",
    confidence: 0,
    cachePolicy: {
      ttlClass: "stream-manifest",
      scope: "local",
      keyParts: [sourceId],
    },
    metadata: {
      server: endpoint,
      flavorId,
      flavorArchetype: subtitle,
      failureReason: reason,
      phase: "B",
    },
  };
}

function mergeInventorySources(
  base: ProviderResolveResult,
  sources: readonly ProviderSourceCandidate[],
  streams: ProviderResolveResult["streams"],
  subtitles: ProviderResolveResult["subtitles"],
): ProviderResolveResult {
  const byId = new Map((base.sources ?? []).map((source) => [source.id, source]));
  for (const source of sources) {
    byId.set(source.id, source);
  }
  return {
    ...base,
    sources: [...byId.values()],
    streams,
    subtitles,
  };
}
