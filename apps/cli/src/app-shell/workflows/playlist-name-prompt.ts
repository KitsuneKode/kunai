import {
  buildPickerActionContext,
  chooseTextInputShell,
  normalizeTextInputValue,
  type ListShellActionContext,
} from "@/app-shell/pickers";
import type { Container } from "@/container";

export function defaultPlaylistNameSuggestion(): string {
  return `Playlist ${new Date().toISOString().slice(0, 10)}`;
}

export async function promptPlaylistName(
  container: Container,
  {
    title,
    subtitle,
    initialValue,
    actionContext,
  }: {
    title: string;
    subtitle: string;
    initialValue?: string;
    actionContext?: ListShellActionContext;
  },
): Promise<string | null> {
  void actionContext;
  const entered = await chooseTextInputShell({
    title,
    subtitle,
    initialValue: initialValue ?? defaultPlaylistNameSuggestion(),
    placeholder: "Playlist name",
    label: "Playlist name",
  });
  return entered ? normalizeTextInputValue(entered) : null;
}

export function buildPlaylistWorkflowContext(
  container: Container,
  taskLabel: string,
): ListShellActionContext {
  return buildPickerActionContext({ container, taskLabel });
}
