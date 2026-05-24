export type ProviderResolveUserState =
  | "slow-source"
  | "trying-another-source"
  | "using-cached-source"
  | "provider-title-issue"
  | "network-unstable"
  | "no-playable-source";

export type ProviderResolveUserStateCopy = {
  readonly state: ProviderResolveUserState;
  readonly title: string;
  readonly detail: string;
};

export function classifyProviderResolveUserState(input: {
  readonly issue?: string | null;
  readonly elapsedSeconds?: number;
}): ProviderResolveUserStateCopy | null {
  const issue = input.issue?.trim().toLowerCase() ?? "";

  if (
    issue.includes("offline") ||
    issue.includes("network unstable") ||
    issue.includes("network looks unstable") ||
    issue.includes("internet disconnected") ||
    issue.includes("could not resolve")
  ) {
    return {
      state: "network-unstable",
      title: "Network looks unstable",
      detail:
        "Kunai paused provider fallback so a local connection problem is not blamed on a source.",
    };
  }
  if (
    issue.includes("no source") ||
    issue.includes("no playable source") ||
    issue.includes("source unavailable") ||
    issue.includes("quality variants unavailable")
  ) {
    return {
      state: "no-playable-source",
      title: "No playable source found",
      detail:
        "No confirmed stream is available for this selection. Try another source or provider.",
    };
  }
  if (issue.includes("using cached") || issue.includes("cached source")) {
    return {
      state: "using-cached-source",
      title: "Using cached source",
      detail: "The fresh lookup failed, so Kunai kept the last playable cached stream.",
    };
  }
  if (issue.includes("this title") || issue.includes("title provider issue")) {
    return {
      state: "provider-title-issue",
      title: "Provider issue for this title",
      detail:
        "This provider has failed repeatedly for this title; other titles may still work normally.",
    };
  }
  if (
    issue.includes("degraded") ||
    issue.includes("timed out") ||
    issue.includes("timeout") ||
    (input.elapsedSeconds ?? 0) >= 20
  ) {
    return {
      state: "slow-source",
      title: "Slow source",
      detail: "This source is taking longer than expected. You can wait or try another source.",
    };
  }
  if (issue.includes("fallback") || issue.includes("trying another source")) {
    return {
      state: "trying-another-source",
      title: "Trying another source",
      detail:
        "The previous source did not resolve cleanly. Kunai is trying a compatible alternative.",
    };
  }
  return null;
}
