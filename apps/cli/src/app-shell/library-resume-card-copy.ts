import { plainModeEnabled } from "./plain-mode";

/** Resume-card copy shared by the library shelf and its plain-mode capture. */
export function libraryResumeCardCopy(input: {
  readonly titleName: string;
  readonly nextPlayableEpisodeLabel?: string;
}) {
  if (plainModeEnabled()) {
    return {
      label: input.nextPlayableEpisodeLabel
        ? `${input.nextPlayableEpisodeLabel} offline`
        : input.titleName,
      action: "enter",
    };
  }
  return {
    label: input.nextPlayableEpisodeLabel
      ? `▸ Resume ${input.nextPlayableEpisodeLabel} offline`
      : `▸ Open ${input.titleName}`,
    action: "↵ enter",
  };
}
