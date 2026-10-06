export const CURRENT_LABEL_SUFFIX = "  ·  current";

export function markCurrentLabel(label: string, current: boolean): string {
  return current ? `${label}${CURRENT_LABEL_SUFFIX}` : label;
}

export function hasCurrentLabel(label: string): boolean {
  return label.endsWith(CURRENT_LABEL_SUFFIX);
}

export function stripCurrentLabel(label: string): string {
  return hasCurrentLabel(label) ? label.slice(0, -CURRENT_LABEL_SUFFIX.length) : label;
}
