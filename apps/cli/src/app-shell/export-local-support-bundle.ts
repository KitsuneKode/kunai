import { basename } from "node:path";

import type { Container } from "@/container";
import { pruneOldDiagnosticFiles } from "@/services/diagnostics/retention";
import { buildRuntimeHealthSnapshot } from "@/services/diagnostics/runtime-health";
import type {
  DiagnosticsBundleEnvironment,
  DiagnosticsSupportBundle,
} from "@/services/diagnostics/support-bundle";
import {
  buildDeclaredSchemaVersions,
  probeMpvVersion,
  resolveEnabledProviderIds,
  resolveTerminalName,
  writeSupportBundleFile,
  type WriteSupportBundleResult,
} from "@/services/diagnostics/write-support-bundle";
import { buildPlaybackSourceInventoryDiagnosticsSummary } from "@/services/playback/PlaybackSourceInventoryProjection";

export type ExportLocalSupportBundleResult = WriteSupportBundleResult & {
  readonly bundle: DiagnosticsSupportBundle;
};

/**
 * App-shell orchestrator for local-only support-bundle export.
 * Keeps `@/container` out of diagnostics services. Never uploads.
 */
export async function exportLocalSupportBundle(
  container: Container,
  options: {
    readonly directory?: string;
    readonly now?: Date;
    readonly mpvVersion?: string | null;
    /** Filename prefix; defaults to support-bundle. Report-issue may use a report prefix. */
    readonly filePrefix?: string;
    readonly prunePrefixes?: readonly string[];
  } = {},
): Promise<ExportLocalSupportBundleResult> {
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
    filePrefix: options.filePrefix,
  });
  const prunePrefixes = options.prunePrefixes ?? [
    "kunai-support-bundle-",
    "kunai-diagnostics-export-",
  ];
  for (const prefix of prunePrefixes) {
    await pruneOldDiagnosticFiles({
      dir: options.directory ?? process.cwd(),
      prefix,
      maxFiles: 10,
    });
  }
  return { ...written, bundle };
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

/** Safe post-export diagnostic context: basename only, no absolute paths or trace paths. */
export function buildSupportBundleExportDiagnosticContext(fileName: string): {
  readonly path: string;
} {
  return { path: basename(fileName) };
}
