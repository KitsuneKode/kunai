import type {
  ResolveBudgetLane,
  ResolveFreshnessPolicy,
  ResolveIntentKind,
} from "./ResolveWorkLedger";

export type ProviderWorkLane =
  | "foreground-playback"
  | "near-need-prefetch"
  | "background-inventory"
  | "manual-diagnostic";

export type ProviderWorkDiagnosticsLevel = "summary" | "trace" | "full";

export type ProviderWorkLanePolicy = {
  readonly timeoutMs: number;
  readonly concurrency: number;
  readonly freshness: ResolveFreshnessPolicy;
  readonly mayUseCachedInventory: boolean;
  readonly diagnosticsLevel: ProviderWorkDiagnosticsLevel;
  readonly cancelWhenUnobserved: boolean;
};

export function providerWorkLaneForRequest(input: {
  readonly intentKind: ResolveIntentKind;
  readonly budgetLane: ResolveBudgetLane;
}): ProviderWorkLane {
  if (input.intentKind === "diagnostic" || input.budgetLane === "manual-diagnostic") {
    return "manual-diagnostic";
  }
  if (input.intentKind === "prefetch" && input.budgetLane === "background") {
    return "background-inventory";
  }
  if (input.intentKind === "prefetch" || input.budgetLane === "near-need") {
    return "near-need-prefetch";
  }
  return "foreground-playback";
}

export function providerWorkLanePolicy(lane: ProviderWorkLane): ProviderWorkLanePolicy {
  switch (lane) {
    case "foreground-playback":
      return {
        timeoutMs: 12_000,
        concurrency: 1,
        freshness: "validate-before-use",
        mayUseCachedInventory: true,
        diagnosticsLevel: "trace",
        cancelWhenUnobserved: true,
      };
    case "near-need-prefetch":
      return {
        timeoutMs: 20_000,
        concurrency: 1,
        freshness: "trust-fresh",
        mayUseCachedInventory: true,
        diagnosticsLevel: "summary",
        cancelWhenUnobserved: true,
      };
    case "background-inventory":
      return {
        timeoutMs: 30_000,
        concurrency: 2,
        freshness: "trust-fresh",
        mayUseCachedInventory: true,
        diagnosticsLevel: "summary",
        cancelWhenUnobserved: true,
      };
    case "manual-diagnostic":
      return {
        timeoutMs: 45_000,
        concurrency: 1,
        freshness: "force-fresh",
        mayUseCachedInventory: false,
        diagnosticsLevel: "full",
        cancelWhenUnobserved: false,
      };
  }
}
