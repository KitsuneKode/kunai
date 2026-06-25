/** Trim workflow text input; empty strings are treated as cancel. */
export function normalizeTextInputValue(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function chooseTextInputShell({
  title,
  subtitle,
  initialValue = "",
  placeholder,
  label = "Name",
}: {
  title: string;
  subtitle: string;
  initialValue?: string;
  placeholder?: string;
  label?: string;
}): Promise<string | null> {
  const { openTextInputShell } = await import("@/app-shell/ink-shell");
  return openTextInputShell({ title, subtitle, initialValue, placeholder, label });
}
