import type {
  ListShellActionContext,
  ListShellFilterPreference,
  ShellOption,
} from "@/app-shell/pickers/list-shell-types";

export async function chooseFromListShell<T>({
  title,
  subtitle,
  options,
  actionContext,
  initialSelectedIndex,
  filter = "auto",
}: {
  title: string;
  subtitle: string;
  options: readonly ShellOption<T>[];
  actionContext?: ListShellActionContext;
  /** Re-open a list on the row the user was working on, not the top. */
  initialSelectedIndex?: number;
  filter?: ListShellFilterPreference;
}): Promise<T | null> {
  const { openListShell } = await import("@/app-shell/ink-shell");
  return openListShell({ title, subtitle, options, actionContext, initialSelectedIndex, filter });
}
