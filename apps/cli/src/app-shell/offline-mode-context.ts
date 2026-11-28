import { applyOfflineCommandAvailability } from "@/domain/session/offline-command-availability";
import { ONLINE_MODE, type OfflineMode } from "@/domain/session/offline-mode";
import React from "react";

const OfflineModeContext = React.createContext<OfflineMode>(ONLINE_MODE);

export const OfflineModeProvider = OfflineModeContext.Provider;

export function useOfflineMode(): OfflineMode {
  return React.useContext(OfflineModeContext);
}

export function useOfflineBrowseCommands<
  T extends { readonly id: string; readonly enabled: boolean; readonly reason?: string },
>(baseCommands: readonly T[]) {
  const offlineMode = useOfflineMode();
  const commands = React.useMemo(
    () =>
      baseCommands.map((command) => applyOfflineCommandAvailability(command, offlineMode.active)),
    [baseCommands, offlineMode.active],
  );
  const catalogSearchOptions = React.useMemo(
    () => ({ catalogSearch: true, offline: offlineMode.active }) as const,
    [offlineMode.active],
  );
  return { commands, catalogSearchOptions, offlineMode };
}
