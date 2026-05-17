export type SourceRefreshAction = "refresh" | "recover";

export type SourceRefreshScope = {
  readonly titleId: string;
  readonly season?: number;
  readonly episode?: number;
  readonly providerId: string;
  readonly sourceId?: string | null;
  readonly streamId?: string | null;
};

export type SourceRefreshDecision =
  | {
      readonly kind: "refresh";
      readonly bypassCache: true;
      readonly invalidateSuspectCache: false;
    }
  | {
      readonly kind: "recover";
      readonly bypassCache: true;
      readonly invalidateSuspectCache: true;
    }
  | {
      readonly kind: "cooldown";
      readonly message: "Source was refreshed recently. Continuing current stream.";
      readonly remainingMs: number;
    };

export type SourceRefreshCooldownState = {
  lastRefreshedAt(scope: SourceRefreshScope): number | undefined;
  recordRefresh(scope: SourceRefreshScope, nowMs: number): void;
};

export function createSourceRefreshCooldownState(): SourceRefreshCooldownState {
  const refreshedAtByScope = new Map<string, number>();

  return {
    lastRefreshedAt(scope) {
      return refreshedAtByScope.get(toSourceRefreshScopeKey(scope));
    },
    recordRefresh(scope, nowMs) {
      refreshedAtByScope.set(toSourceRefreshScopeKey(scope), nowMs);
    },
  };
}

export function resolveSourceRefreshDecision(
  state: SourceRefreshCooldownState,
  input: {
    readonly action: SourceRefreshAction;
    readonly scope: SourceRefreshScope;
    readonly now: Date;
    readonly cooldownMs: number;
  },
): SourceRefreshDecision {
  if (input.action === "recover") {
    return {
      kind: "recover",
      bypassCache: true,
      invalidateSuspectCache: true,
    };
  }

  const nowMs = input.now.getTime();
  const lastAt = state.lastRefreshedAt(input.scope);
  if (lastAt !== undefined) {
    const elapsedMs = nowMs - lastAt;
    if (elapsedMs >= 0 && elapsedMs < input.cooldownMs) {
      return {
        kind: "cooldown",
        message: "Source was refreshed recently. Continuing current stream.",
        remainingMs: input.cooldownMs - elapsedMs,
      };
    }
  }

  state.recordRefresh(input.scope, nowMs);
  return {
    kind: "refresh",
    bypassCache: true,
    invalidateSuspectCache: false,
  };
}

function toSourceRefreshScopeKey(scope: SourceRefreshScope): string {
  return [
    scope.titleId,
    scope.season ?? "movie",
    scope.episode ?? "movie",
    scope.providerId,
    scope.sourceId ?? "source:any",
    scope.streamId ?? "stream:any",
  ].join(":");
}
