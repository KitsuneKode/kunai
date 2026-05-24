import { createHash } from "node:crypto";

import type { EpisodeInfo, ShellMode, TitleInfo } from "@/domain/types";
import type { ProviderResolveResult } from "@kunai/types";

export type ResolveBudgetLane = "user-blocking" | "near-need" | "background" | "manual-diagnostic";

export type ResolveIntentKind = "playback" | "prefetch" | "recovery" | "download" | "diagnostic";

export type ResolveWorkPurpose = "playable" | "recovery" | "download" | "diagnostic";

export type ResolveFreshnessPolicy = "trust-fresh" | "validate-before-use" | "force-fresh";

export type ResolveWorkIdentityInput = {
  readonly title: TitleInfo;
  readonly episode: EpisodeInfo;
  readonly mode: ShellMode;
  readonly providerId: string;
  readonly audioPreference: string;
  readonly subtitlePreference: string;
  readonly qualityPreference?: string;
  readonly selectedSourceId?: string;
  readonly selectedStreamId?: string;
  readonly purpose: ResolveWorkPurpose;
  readonly freshnessPolicy: ResolveFreshnessPolicy;
};

export type ResolveCacheDecision =
  | "prefetched"
  | "hit"
  | "miss"
  | "stale"
  | "validated"
  | "inventory-hit"
  | "fresh-failed-cache-fallback";

export type ResolveWorkProviderAttempt = {
  readonly providerId: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly outcome?: "success" | "failure";
  readonly issueClass?: string;
};

export type ResolveWorkLedgerSnapshot = {
  readonly resolveWorkKey: string;
  readonly mediaIdentityHash: string;
  readonly purpose: ResolveWorkPurpose;
  readonly freshnessPolicy: ResolveFreshnessPolicy;
  readonly initiatingIntent: ResolveIntentKind;
  readonly intents: readonly ResolveIntentKind[];
  readonly initiatingBudgetLane: ResolveBudgetLane;
  readonly joinedBudgetLanes: readonly ResolveBudgetLane[];
  readonly cacheDecisions: readonly ResolveCacheDecision[];
  readonly providerAttempts: readonly ResolveWorkProviderAttempt[];
  readonly inventory: {
    readonly hit: boolean;
    readonly sourceCount?: number;
    readonly streamCount?: number;
    readonly variantCount?: number;
    readonly subtitleCount?: number;
    readonly audioLanguageCount?: number;
    readonly hardSubLanguageCount?: number;
    readonly hasArtwork?: boolean;
    readonly hasTimingHints?: boolean;
    readonly externalIdCount?: number;
    readonly selectedSourceId?: string;
    readonly selectedStreamId?: string;
  };
  readonly outcome?: "resolved" | "unavailable" | "cancelled";
};

type ResolveWorkLedgerState = {
  resolveWorkKey: string;
  mediaIdentityHash: string;
  purpose: ResolveWorkPurpose;
  freshnessPolicy: ResolveFreshnessPolicy;
  initiatingIntent: ResolveIntentKind;
  intents: ResolveIntentKind[];
  initiatingBudgetLane: ResolveBudgetLane;
  joinedBudgetLanes: ResolveBudgetLane[];
  cacheDecisions: ResolveCacheDecision[];
  providerAttempts: ResolveWorkProviderAttempt[];
  inventory: {
    hit: boolean;
    sourceCount?: number;
    streamCount?: number;
    variantCount?: number;
    subtitleCount?: number;
    audioLanguageCount?: number;
    hardSubLanguageCount?: number;
    hasArtwork?: boolean;
    hasTimingHints?: boolean;
    externalIdCount?: number;
    selectedSourceId?: string;
    selectedStreamId?: string;
  };
  outcome?: "resolved" | "unavailable" | "cancelled";
};

export type ResolveWorkLedger = {
  readonly state: ResolveWorkLedgerState;
};

export function resolveWorkPurposeForIntent(intent: ResolveIntentKind): ResolveWorkPurpose {
  switch (intent) {
    case "playback":
    case "prefetch":
      return "playable";
    case "recovery":
      return "recovery";
    case "download":
      return "download";
    case "diagnostic":
      return "diagnostic";
  }
}

export function buildResolveWorkKey(input: ResolveWorkIdentityInput): string {
  return `resolve:${hash({
    title: input.title.id,
    episode: [input.episode.season, input.episode.episode],
    mode: input.mode,
    providerId: input.providerId,
    audioPreference: input.audioPreference,
    subtitlePreference: input.subtitlePreference,
    qualityPreference: input.qualityPreference ?? null,
    selectedSourceId: input.selectedSourceId ?? null,
    selectedStreamId: input.selectedStreamId ?? null,
    purpose: input.purpose,
    freshnessPolicy: input.freshnessPolicy,
  })}`;
}

export function createResolveWorkLedger(input: {
  readonly identity: ResolveWorkIdentityInput;
  readonly intent: ResolveIntentKind;
  readonly budgetLane: ResolveBudgetLane;
}): ResolveWorkLedger {
  return {
    state: {
      resolveWorkKey: buildResolveWorkKey(input.identity),
      mediaIdentityHash: hash({
        title: input.identity.title.id,
        episode: [input.identity.episode.season, input.identity.episode.episode],
        mode: input.identity.mode,
      }),
      purpose: input.identity.purpose,
      freshnessPolicy: input.identity.freshnessPolicy,
      initiatingIntent: input.intent,
      intents: [input.intent],
      initiatingBudgetLane: input.budgetLane,
      joinedBudgetLanes: [input.budgetLane],
      cacheDecisions: [],
      providerAttempts: [],
      inventory: { hit: false },
    },
  };
}

export function recordLedgerJoin(
  ledger: ResolveWorkLedger,
  input: { readonly intent: ResolveIntentKind; readonly budgetLane: ResolveBudgetLane },
): void {
  addUnique(ledger.state.intents, input.intent);
  addUnique(ledger.state.joinedBudgetLanes, input.budgetLane);
}

export function recordCacheDecision(
  ledger: ResolveWorkLedger,
  decision: ResolveCacheDecision,
): void {
  ledger.state.cacheDecisions.push(decision);
  if (decision === "inventory-hit") ledger.state.inventory.hit = true;
}

export function recordProviderAttempt(
  ledger: ResolveWorkLedger,
  attempt: ResolveWorkProviderAttempt,
): void {
  const existingIndex = ledger.state.providerAttempts.findIndex(
    (existing) =>
      existing.providerId === attempt.providerId && existing.attempt === attempt.attempt,
  );
  if (existingIndex >= 0) {
    ledger.state.providerAttempts[existingIndex] = {
      ...ledger.state.providerAttempts[existingIndex],
      ...attempt,
    };
    return;
  }
  ledger.state.providerAttempts.push(attempt);
}

export function recordInventoryFacts(
  ledger: ResolveWorkLedger,
  facts: {
    readonly sourceCount?: number;
    readonly streamCount?: number;
    readonly variantCount?: number;
    readonly subtitleCount?: number;
    readonly audioLanguageCount?: number;
    readonly hardSubLanguageCount?: number;
    readonly hasArtwork?: boolean;
    readonly hasTimingHints?: boolean;
    readonly externalIdCount?: number;
    readonly selectedSourceId?: string;
    readonly selectedStreamId?: string;
  },
): void {
  ledger.state.inventory = { ...ledger.state.inventory, ...facts };
}

export function recordProviderInventoryFacts(
  ledger: ResolveWorkLedger,
  result: Pick<
    ProviderResolveResult,
    | "sources"
    | "streams"
    | "variants"
    | "subtitles"
    | "artwork"
    | "externalIds"
    | "selectedStreamId"
  >,
): void {
  const sourceIds = new Set(result.sources?.map((source) => source.id) ?? []);
  for (const stream of result.streams) {
    if (stream.sourceId) sourceIds.add(stream.sourceId);
  }
  const audioLanguages = new Set<string>();
  const hardSubLanguages = new Set<string>();
  let hasStreamArtwork = Boolean(result.artwork);
  let hasTimingHints = false;
  for (const stream of result.streams) {
    stream.audioLanguages?.forEach((language) => audioLanguages.add(language));
    if (stream.hardSubLanguage) hardSubLanguages.add(stream.hardSubLanguage);
    if (stream.artwork) hasStreamArtwork = true;
    if (stream.metadata && hasProviderTimingHint(stream.metadata)) hasTimingHints = true;
  }
  recordInventoryFacts(ledger, {
    sourceCount: sourceIds.size || result.sources?.length,
    streamCount: result.streams.length,
    variantCount: result.variants?.length,
    subtitleCount: result.subtitles.length,
    audioLanguageCount: audioLanguages.size,
    hardSubLanguageCount: hardSubLanguages.size,
    hasArtwork: hasStreamArtwork || undefined,
    hasTimingHints: hasTimingHints || undefined,
    externalIdCount: countKnownExternalIds(result.externalIds),
    selectedStreamId: result.selectedStreamId,
    selectedSourceId: result.streams.find((stream) => stream.id === result.selectedStreamId)
      ?.sourceId,
  });
}

export function finalizeResolveWorkLedger(
  ledger: ResolveWorkLedger,
  outcome?: ResolveWorkLedgerSnapshot["outcome"],
): ResolveWorkLedgerSnapshot {
  if (outcome) ledger.state.outcome = outcome;
  return {
    ...ledger.state,
    intents: [...ledger.state.intents],
    joinedBudgetLanes: [...ledger.state.joinedBudgetLanes],
    cacheDecisions: [...ledger.state.cacheDecisions],
    providerAttempts: [...ledger.state.providerAttempts],
    inventory: { ...ledger.state.inventory },
  };
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

function addUnique<T>(values: T[], value: T): void {
  if (!values.includes(value)) values.push(value);
}

function countKnownExternalIds(value: ProviderResolveResult["externalIds"]): number | undefined {
  if (!value) return undefined;
  const count = Object.values(value).filter(
    (entry) => entry !== undefined && entry !== null,
  ).length;
  return count > 0 ? count : undefined;
}

function hasProviderTimingHint(metadata: Record<string, unknown>): boolean {
  return (
    Boolean(metadata.intro) ||
    Boolean(metadata.outro) ||
    Boolean(metadata.introStart) ||
    Boolean(metadata.introEnd) ||
    Boolean(metadata.outroStart) ||
    Boolean(metadata.outroEnd)
  );
}
