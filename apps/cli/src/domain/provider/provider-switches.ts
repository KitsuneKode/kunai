// Pure helpers for the user's provider on/off switches (`disabledProviders`).

function normalizeDisabledId(id: string): string {
  return id.trim().toLowerCase();
}

/** True when the provider id is not on the user's disabled list. */
export function isProviderEnabled(
  disabledProviders: readonly string[] | undefined,
  providerId: string,
): boolean {
  if (!disabledProviders || disabledProviders.length === 0) return true;
  const normalized = normalizeDisabledId(providerId);
  return !disabledProviders.some((entry) => normalizeDisabledId(entry) === normalized);
}

/** Set one provider's switch, preserving every other entry (case-insensitive id match). */
export function setProviderEnabled(
  disabledProviders: readonly string[],
  providerId: string,
  enabled: boolean,
): readonly string[] {
  const others = disabledProviders.filter((entry) => isProviderEnabled([providerId], entry));
  return enabled ? others : [...others, providerId];
}

export function toggleProviderSwitch(
  disabledProviders: readonly string[],
  providerId: string,
): readonly string[] {
  return setProviderEnabled(
    disabledProviders,
    providerId,
    !isProviderEnabled(disabledProviders, providerId),
  );
}
