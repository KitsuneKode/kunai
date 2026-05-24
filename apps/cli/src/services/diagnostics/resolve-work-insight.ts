import type { ResolveWorkLedgerSnapshot } from "@/services/playback/ResolveWorkLedger";

export type ResolveWorkDiagnosticsInsight = {
  readonly workCount: number;
  readonly physicalWork: readonly ResolveWorkDiagnosticsNode[];
  readonly totals: {
    readonly providerAttemptCount: number;
    readonly sourceCount: number;
    readonly streamCount: number;
    readonly variantCount: number;
    readonly subtitleCount: number;
  };
};

export type ResolveWorkDiagnosticsNode = {
  readonly resolveWorkKey: string;
  readonly mediaIdentityHash: string;
  readonly purpose: ResolveWorkLedgerSnapshot["purpose"];
  readonly freshnessPolicy: ResolveWorkLedgerSnapshot["freshnessPolicy"];
  readonly intents: readonly ResolveWorkLedgerSnapshot["initiatingIntent"][];
  readonly joinedBudgetLanes: ResolveWorkLedgerSnapshot["joinedBudgetLanes"];
  readonly cacheProvenance: readonly string[];
  readonly attemptGraph: readonly {
    readonly providerId: string;
    readonly attempt: number;
    readonly maxAttempts: number;
    readonly outcome?: string;
    readonly issueClass?: string;
  }[];
  readonly inventory: ResolveWorkLedgerSnapshot["inventory"];
  readonly requestCounts: {
    readonly providerAttemptCount: number;
  };
  readonly outcome?: ResolveWorkLedgerSnapshot["outcome"];
};

export function buildResolveWorkDiagnosticsInsight(
  ledgers: readonly ResolveWorkLedgerSnapshot[] | undefined,
): ResolveWorkDiagnosticsInsight | undefined {
  if (!ledgers || ledgers.length === 0) return undefined;

  const physicalWork = ledgers.map((ledger) => ({
    resolveWorkKey: ledger.resolveWorkKey,
    mediaIdentityHash: ledger.mediaIdentityHash,
    purpose: ledger.purpose,
    freshnessPolicy: ledger.freshnessPolicy,
    intents: ledger.intents,
    joinedBudgetLanes: ledger.joinedBudgetLanes,
    cacheProvenance: ledger.cacheDecisions,
    attemptGraph: ledger.providerAttempts.map((attempt) => ({
      providerId: attempt.providerId,
      attempt: attempt.attempt,
      maxAttempts: attempt.maxAttempts,
      outcome: attempt.outcome,
      issueClass: attempt.issueClass,
    })),
    inventory: ledger.inventory,
    requestCounts: {
      providerAttemptCount: ledger.providerAttempts.length,
    },
    outcome: ledger.outcome,
  }));

  return {
    workCount: physicalWork.length,
    physicalWork,
    totals: {
      providerAttemptCount: sum(physicalWork, (work) => work.requestCounts.providerAttemptCount),
      sourceCount: sum(physicalWork, (work) => work.inventory.sourceCount ?? 0),
      streamCount: sum(physicalWork, (work) => work.inventory.streamCount ?? 0),
      variantCount: sum(physicalWork, (work) => work.inventory.variantCount ?? 0),
      subtitleCount: sum(physicalWork, (work) => work.inventory.subtitleCount ?? 0),
    },
  };
}

function sum<T>(items: readonly T[], select: (item: T) => number): number {
  return items.reduce((total, item) => total + select(item), 0);
}
