export type PlaybackSourceEntrypoint = "online-search" | "continue" | "offline-library";

export type PlaybackSourcePreference = "ask" | "prefer-local" | "prefer-online";

export type LocalSourceStatus =
  | "none"
  | "ready"
  | "missing-file"
  | "invalid-file"
  | "queued"
  | "downloading";

export type PlaybackSourceKind = "local" | "online" | "blocked";

export type SourceSelectionActionKind =
  | "play-local"
  | "watch-online"
  | "repair-local"
  | "browse-offline";

export type SourceSelectionAction = {
  readonly kind: SourceSelectionActionKind;
  readonly label: string;
  readonly detail: string;
};

export type SourceSelectionDecision = {
  readonly source: PlaybackSourceKind;
  readonly shouldResolveOnline: boolean;
  readonly reason:
    | "offline-entry"
    | "local-continuation"
    | "online-first"
    | "local-unavailable"
    | "local-needs-repair"
    | "network-unavailable";
  readonly localStatus: LocalSourceStatus;
  readonly actions: readonly SourceSelectionAction[];
};

export type SourceSelectionEngine = {
  decide(input: {
    readonly entrypoint: PlaybackSourceEntrypoint;
    readonly local: {
      readonly status: LocalSourceStatus;
      readonly jobId?: string;
    };
    readonly networkAvailable: boolean;
    readonly preference?: PlaybackSourcePreference;
  }): SourceSelectionDecision;
};

export function createSourceSelectionEngine(): SourceSelectionEngine {
  return {
    decide(input) {
      const preference = input.preference ?? "ask";
      const localStatus = input.local.status;

      if (input.entrypoint === "offline-library") {
        return localStatus === "ready"
          ? localDecision("offline-entry", localStatus)
          : blockedOfflineDecision(localStatus);
      }

      if (input.entrypoint === "continue" && localStatus === "ready") {
        return localDecision("local-continuation", localStatus, input.networkAvailable);
      }

      if (
        input.entrypoint === "online-search" &&
        localStatus === "ready" &&
        preference === "prefer-local"
      ) {
        return localDecision("local-continuation", localStatus, input.networkAvailable);
      }

      if (isBrokenLocal(localStatus)) {
        return repairOrBlockedDecision(localStatus, input.networkAvailable);
      }

      if (input.networkAvailable) {
        return {
          source: "online",
          shouldResolveOnline: true,
          reason: localStatus === "ready" ? "online-first" : "local-unavailable",
          localStatus,
          actions:
            localStatus === "ready"
              ? [WATCH_ONLINE, PLAY_LOCAL]
              : localStatus === "none"
                ? [WATCH_ONLINE]
                : [WATCH_ONLINE, BROWSE_OFFLINE],
        };
      }

      return {
        source: "blocked",
        shouldResolveOnline: false,
        reason: "network-unavailable",
        localStatus,
        actions: [BROWSE_OFFLINE],
      };
    },
  };
}

const PLAY_LOCAL: SourceSelectionAction = {
  kind: "play-local",
  label: "Play downloaded copy",
  detail: "Use the verified local file without provider resolution",
};

const WATCH_ONLINE: SourceSelectionAction = {
  kind: "watch-online",
  label: "Watch online",
  detail: "Resolve a provider stream only when this action is chosen",
};

const REPAIR_LOCAL: SourceSelectionAction = {
  kind: "repair-local",
  label: "Repair download",
  detail: "Check integrity or queue a fresh download before local playback",
};

const BROWSE_OFFLINE: SourceSelectionAction = {
  kind: "browse-offline",
  label: "Browse offline library",
  detail: "Stay local-only and choose an available downloaded title",
};

function localDecision(
  reason: "offline-entry" | "local-continuation",
  localStatus: LocalSourceStatus,
  networkAvailable = false,
): SourceSelectionDecision {
  return {
    source: "local",
    shouldResolveOnline: false,
    reason,
    localStatus,
    actions: networkAvailable ? [PLAY_LOCAL, WATCH_ONLINE] : [PLAY_LOCAL],
  };
}

function repairOrBlockedDecision(
  localStatus: LocalSourceStatus,
  networkAvailable: boolean,
): SourceSelectionDecision {
  if (networkAvailable) {
    return {
      source: "online",
      shouldResolveOnline: true,
      reason: "local-needs-repair",
      localStatus,
      actions: [REPAIR_LOCAL, WATCH_ONLINE],
    };
  }

  return {
    source: "blocked",
    shouldResolveOnline: false,
    reason: "local-needs-repair",
    localStatus,
    actions: [REPAIR_LOCAL, BROWSE_OFFLINE],
  };
}

function blockedOfflineDecision(localStatus: LocalSourceStatus): SourceSelectionDecision {
  return {
    source: "blocked",
    shouldResolveOnline: false,
    reason: isBrokenLocal(localStatus) ? "local-needs-repair" : "local-unavailable",
    localStatus,
    actions: isBrokenLocal(localStatus) ? [REPAIR_LOCAL, BROWSE_OFFLINE] : [BROWSE_OFFLINE],
  };
}

function isBrokenLocal(status: LocalSourceStatus): boolean {
  return status === "missing-file" || status === "invalid-file";
}
