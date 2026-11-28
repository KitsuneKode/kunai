/**
 * The shell-wide offline decision. Connectivity owns detection and explicit
 * user intent; this type is the single value surfaces receive so they do not
 * independently re-derive (or contradict) that decision.
 */
export type OfflineMode = {
  readonly active: boolean;
  readonly source: "explicit" | "network" | null;
};

export const ONLINE_MODE: OfflineMode = { active: false, source: null };

export function deriveOfflineMode({
  explicitOffline,
  networkAvailable,
}: {
  readonly explicitOffline: boolean;
  readonly networkAvailable: boolean;
}): OfflineMode {
  if (explicitOffline) return { active: true, source: "explicit" };
  if (!networkAvailable) return { active: true, source: "network" };
  return ONLINE_MODE;
}
