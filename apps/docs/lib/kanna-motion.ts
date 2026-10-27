"use client";

import { useSyncExternalStore } from "react";

// One tab-wide preference: the footer control also stops the pointer roamer.
// Kept in memory so no storage or hydration permission is needed.
let paused = false;
const listeners = new Set<() => void>();
export const getKannaPaused = () => paused;
const serverSnapshot = () => false;

export function subscribeKannaMotion(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setKannaPaused(value: boolean) {
  if (paused === value) return;
  paused = value;
  for (const listener of listeners) listener();
}

export function useKannaPaused() {
  return useSyncExternalStore(subscribeKannaMotion, getKannaPaused, serverSnapshot);
}
