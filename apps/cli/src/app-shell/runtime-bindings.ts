import {
  buildAboutPanelLines,
  buildDiagnosticsPanelLines,
  buildHelpPanelLines,
  buildHistoryPanelLines,
  buildProviderPickerOptions,
} from "@/app-shell/panel-data";
import { applySettingsToRuntime } from "@/app-shell/workflows";
import type { Container } from "@/container";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";

export function buildShellRuntimeBindings(container: Container) {
  const { providerRegistry, stateManager, diagnosticsStore, historyStore, config } = container;
  const state = stateManager.getState();
  const rawConfig = config.getRaw();

  const providers = providerRegistry.getAll().map((provider) => provider.metadata);

  return {
    providerOptions: buildProviderPickerOptions({
      providers: providers.filter(
        (metadata) => metadata.isAnimeProvider === (state.mode === "anime"),
      ),
      currentProvider: state.provider,
    }),
    settings: rawConfig,
    settingsSeriesProviderOptions: buildProviderPickerOptions({
      providers: providers.filter((metadata) => !metadata.isAnimeProvider),
      currentProvider: rawConfig.provider,
    }),
    settingsAnimeProviderOptions: buildProviderPickerOptions({
      providers: providers.filter((metadata) => metadata.isAnimeProvider),
      currentProvider: rawConfig.animeProvider,
    }),
    onChangeProvider: async (providerId: string) => {
      stateManager.dispatch({ type: "SET_PROVIDER", provider: providerId });
      diagnosticsStore.record({
        category: "ui",
        message: "Provider switched in-shell",
        context: {
          mode: stateManager.getState().mode,
          provider: providerId,
        },
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
    loadDiagnosticsPanel: async () =>
      buildDiagnosticsPanelLines({
        state: stateManager.getState(),
        recentEvents: diagnosticsStore.getRecent(10),
        capabilitySnapshot: container.capabilitySnapshot,
        downloadSummary: {
          active: container.downloadService.listActive(200).length,
          completed: container.downloadService.listCompleted(200).length,
          failed: container.downloadService.listFailed(200).length,
        },
        presenceSnapshot: container.presence.getSnapshot(),
      }),
    loadHistoryPanel: async () =>
      buildHistoryPanelLines(Object.entries(await historyStore.getAll())),
  };
}
