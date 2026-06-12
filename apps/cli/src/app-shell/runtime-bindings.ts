import {
  buildAboutPanelLines,
  buildDiagnosticsPanelLines,
  buildHelpPanelLines,
  buildHistoryPanelLines,
  buildProviderPickerOptions,
  sortProvidersByConfigPriority,
} from "@/app-shell/panel-data";
import { applySettingsToRuntime } from "@/app/apply-settings-to-runtime";
import type { Container } from "@/container";
import {
  getRuntimeMemoryLine,
  getRuntimeMemorySamples,
  summarizeRuntimeMemoryTrend,
} from "@/services/diagnostics/runtime-memory";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";

export function buildShellRuntimeBindings(container: Container) {
  const {
    providerRegistry,
    stateManager,
    diagnosticsStore,
    diagnosticsService,
    historyStore,
    config,
  } = container;
  const state = stateManager.getState();
  const rawConfig = config.getRaw();

  const seriesProviders = sortProvidersByConfigPriority({
    providers: providerRegistry
      .getAll()
      .map((provider) => provider.metadata)
      .filter((metadata) => !metadata.isAnimeProvider),
    priority: [rawConfig.provider, ...rawConfig.providerPriority],
  });
  const animeProviders = sortProvidersByConfigPriority({
    providers: providerRegistry
      .getAll()
      .map((provider) => provider.metadata)
      .filter((metadata) => metadata.isAnimeProvider),
    priority: [rawConfig.animeProvider, ...rawConfig.animeProviderPriority],
  });

  return {
    providerOptions: buildProviderPickerOptions({
      providers: state.mode === "anime" ? animeProviders : seriesProviders,
      currentProvider: state.provider,
      previewImageUrl: state.currentTitle?.posterUrl,
    }),
    settings: rawConfig,
    settingsSeriesProviderOptions: buildProviderPickerOptions({
      providers: seriesProviders,
      currentProvider: rawConfig.provider,
    }),
    settingsAnimeProviderOptions: buildProviderPickerOptions({
      providers: animeProviders,
      currentProvider: rawConfig.animeProvider,
    }),
    onChangeProvider: async (providerId: string) => {
      const fromProviderId = stateManager.getState().provider;
      if (providerId === fromProviderId) return;
      const snapshot = stateManager.getState();
      const { applyUserProviderSwitch } = await import("@/app/playback-provider-switch");
      await applyUserProviderSwitch({
        container,
        fromProviderId,
        toProviderId: providerId,
        ...(snapshot.currentTitle && snapshot.currentEpisode
          ? {
              title: snapshot.currentTitle,
              episode: snapshot.currentEpisode,
              mode: snapshot.mode,
            }
          : {}),
      });
    },
    onSaveSettings: async (next: KitsuneConfig) => {
      await applySettingsToRuntime({
        container,
        next,
        previous: config.getRaw(),
      });
    },
    loadHelpPanel: async () => buildHelpPanelLines(),
    loadAboutPanel: async () =>
      buildAboutPanelLines({
        config: config.getRaw(),
        state: stateManager.getState(),
        capabilitySnapshot: container.capabilitySnapshot,
      }),
    loadDiagnosticsPanel: async () => {
      const memoryLine = getRuntimeMemoryLine();
      const memoryTrend = summarizeRuntimeMemoryTrend(getRuntimeMemorySamples());
      diagnosticsService.record({
        category: "runtime",
        operation: "runtime.memory.sample",
        message: "Runtime memory sample",
        context: { memory: memoryLine, trend: memoryTrend.detail, source: "diagnostics-panel" },
      });
      return buildDiagnosticsPanelLines({
        state: stateManager.getState(),
        recentEvents: diagnosticsStore.getRecent(25),
        memorySamples: getRuntimeMemorySamples(),
        capabilitySnapshot: container.capabilitySnapshot,
        downloadSummary: {
          active: container.downloadService.listActive(200).length,
          completed: container.downloadService.listCompleted(200).length,
          failed: container.downloadService.listFailed(200).length,
        },
        presenceSnapshot: container.presence.getSnapshot(),
      });
    },
    loadHistoryPanel: async () =>
      buildHistoryPanelLines(Object.entries(await historyStore.getAll())),
  };
}
