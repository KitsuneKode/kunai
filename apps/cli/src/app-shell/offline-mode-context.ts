import { ONLINE_MODE, type OfflineMode } from "@/domain/session/offline-mode";
import React from "react";

const OfflineModeContext = React.createContext<OfflineMode>(ONLINE_MODE);

export const OfflineModeProvider = OfflineModeContext.Provider;

export function useOfflineMode(): OfflineMode {
  return React.useContext(OfflineModeContext);
}
