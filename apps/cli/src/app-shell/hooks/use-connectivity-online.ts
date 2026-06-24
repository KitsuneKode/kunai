import type { Connectivity } from "@/services/network/Connectivity";
import { useSyncExternalStore } from "react";

export function useConnectivityOnline(connectivity: Connectivity): boolean {
  return useSyncExternalStore(
    (listener) => connectivity.subscribe(listener),
    () => connectivity.isOnline(),
    () => connectivity.isOnline(),
  );
}
