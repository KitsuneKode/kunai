import type { Container } from "@/container";
import { pruneOldDiagnosticFiles } from "@/services/diagnostics/retention";
import { buildRuntimeHealthSnapshot } from "@/services/diagnostics/runtime-health";
import type { DiagnosticsBundleEnvironment } from "@/services/diagnostics/support-bundle";
import {
  buildDeclaredSchemaVersions,
  probeMpvVersion,
  resolveEnabledProviderIds,
  resolveTerminalName,
  writeSupportBundleFile,
  type WriteSupportBundleResult,
} from "@/services/diagnostics/write-support-bundle";
import { buildPlaybackSourceInventoryDiagnosticsSummary } from "@/services/playback/PlaybackSourceInventoryProjection";

/**
 * Shared local-only support-bundle export used by `/export-diagnostics`,
 * the diagnostics overlay key, and `--support-bundle`. Never uploads.
 */
export async function exportLocalSupportBundle(
  container: Container,
  options: {
    readonly directory?: string;
    readonly now?: Date;
    readonly mpvVersion?: string | null;
  } = {},
): Promise<WriteSupportBundleResult> {
  const state = container.stateManager.getState();
  const environment = await buildSupportBundleEnvironment(container, {
    mpvVersion: options.mpvVersion,
  });
  const bundle = container.diagnosticsService.buildSupportBundle({
    capabilities: container.capabilitySnapshot as unknown as Record<string, unknown> | null,
    playbackSourceInventory: state.stream?.providerResolveResult
      ? buildPlaybackSourceInventoryDiagnosticsSummary(state.stream.providerResolveResult, {
          selectedSubtitleUrl: state.stream.subtitle,
        })
      : null,
    sessionState: state,
    environment,
  });
  const written = await writeSupportBundleFile({
    bundle,
    directory: options.directory,
    now: options.now,
  });
  await pruneOldDiagnosticFiles({
    dir: options.directory ?? process.cwd(),
    prefix: "kunai-support-bundle-",
    maxFiles: 10,
  });
  // Also prune legacy export filenames so older `/export-diagnostics` files rotate out.
  await pruneOldDiagnosticFiles({
    dir: options.directory ?? process.cwd(),
    prefix: "kunai-diagnostics-export-",
    maxFiles: 10,
  });
  return written;
}

export async function buildSupportBundleEnvironment(
  container: Container,
  options: { readonly mpvVersion?: string | null } = {},
): Promise<DiagnosticsBundleEnvironment> {
  const registeredIds = container.providerRegistry.getAllIds();
  const mpvVersion =
    options.mpvVersion !== undefined ? options.mpvVersion : await probeMpvVersion();
  const imageTerminal = container.capabilitySnapshot?.image.terminal ?? null;
  const health = buildRuntimeHealthSnapshot({
    recentEvents: container.diagnosticsService.getRecent(40),
  });

  return {
    mpvVersion,
    terminal: resolveTerminalName({ imageTerminal }),
    enabledProviders: resolveEnabledProviderIds(
      container.config.getRaw().providerRelay.providers,
      registeredIds,
    ),
    schemaVersions: buildDeclaredSchemaVersions(),
    runtimeHealth: {
      network: health.network.detail,
      provider: health.provider.detail,
      memory: health.memory.detail,
      memoryTrend: health.memoryTrend.detail,
    },
  };
}
