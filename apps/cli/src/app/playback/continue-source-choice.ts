import { hasReadyLocalEpisodePlayback } from "@/app/playback/episode-playback-source";
import type { Container } from "@/container";
import type { EpisodeInfo, TitleInfo } from "@/domain/types";

export type ContinueSourceChoice = "local" | "online";
export type ContinueSourcePromptOutcome = ContinueSourceChoice | "cancelled" | "not-needed";

export function shouldOfferContinueSourcePrompt(input: {
  readonly launchSource?: TitleInfo["launchSource"];
  readonly startAt: number;
  readonly suppressResumePrompt?: boolean;
  readonly playbackSourceOverride?: "local" | "online";
}): boolean {
  if (input.launchSource === "offline-library" || input.playbackSourceOverride) return false;
  if (input.launchSource === "continue") return true;
  return input.startAt > 0 && input.suppressResumePrompt === true;
}

async function chooseContinueSourceWithShell(
  title: TitleInfo,
): Promise<ContinueSourceChoice | null> {
  const { openListShell } = await import("@/app-shell/ink-shell");
  return await openListShell<ContinueSourceChoice>({
    title: "Choose source",
    subtitle: `${title.name} has a downloaded copy and an online stream`,
    options: [
      {
        value: "local",
        label: "Play downloaded copy",
        detail: "Use the verified local file without provider resolution",
      },
      {
        value: "online",
        label: "Stream online",
        detail: "Resolve a provider stream for this episode",
      },
    ],
  });
}

export async function offerContinueSourceChoice(input: {
  readonly container: Container;
  readonly title: TitleInfo;
  readonly episode: EpisodeInfo;
  readonly hasReadyLocal?: () => Promise<boolean>;
  readonly choose?: () => Promise<ContinueSourceChoice | null>;
}): Promise<ContinueSourcePromptOutcome> {
  const { container, title } = input;
  if (container.config.continueSourcePreference !== "ask") return "not-needed";
  if (title.playbackSourceOverride) return "not-needed";
  if (!container.connectivity.isOnline()) return "not-needed";
  const hasReadyLocal =
    input.hasReadyLocal ?? (() => hasReadyLocalEpisodePlayback(container, title, input.episode));
  if (!(await hasReadyLocal())) return "not-needed";
  if (!input.choose && !process.stdin.isTTY) return "online";
  const choice = await (input.choose ?? (() => chooseContinueSourceWithShell(title)))();
  return choice ?? "cancelled";
}
