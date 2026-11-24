import type { StreamInfo } from "@/domain/types";
import { createKeyedJoiner } from "@/infra/concurrency/keyed-joiner";

import {
  PlaybackResolveCoordinator,
  type PlaybackResolveCoordinatorOutput,
} from "./PlaybackResolveCoordinator";
import type {
  PlaybackResolveEvent,
  PlaybackResolveFeedback,
  PlaybackResolveInput,
} from "./PlaybackResolveService";
import {
  buildResolveWorkKey,
  createResolveWorkLedger,
  finalizeResolveWorkLedger,
  recordCacheDecision,
  recordLedgerJoin,
  recordProviderInventoryFacts,
  recordProviderAttempt,
  recordProviderSelectionDecision,
  resolveWorkPurposeForIntent,
  type ResolveBudgetLane,
  type ResolveFreshnessPolicy,
  type ResolveIntentKind,
  type ResolveWorkLedger,
  type ResolveWorkLedgerSnapshot,
} from "./ResolveWorkLedger";

export type PlaybackResolveWorkRequest = {
  readonly intentKind: ResolveIntentKind;
  readonly budgetLane: ResolveBudgetLane;
};

export type PlaybackResolveWorkOutput = PlaybackResolveCoordinatorOutput & {
  readonly workLedger: ResolveWorkLedgerSnapshot;
};

type ResolveCoordinator = Pick<PlaybackResolveCoordinator, "resolve">;

type Consumer = {
  readonly onEvent?: (event: PlaybackResolveEvent) => void;
  readonly onFeedback?: (feedback: PlaybackResolveFeedback) => void;
};

/** What every consumer joined onto one physical resolve shares. */
type ResolveWorkContext = {
  readonly consumers: Set<Consumer>;
  readonly ledger: ResolveWorkLedger;
};

export class PlaybackResolveWorkService {
  /**
   * One physical resolve per work key. Each consumer leaves on its own
   * signal; the last one out aborts the resolve with its reason, which the
   * commit policy reads to tell "user backed out, keep the warm result" from
   * "deadline/fallback, discard".
   */
  private readonly inFlight = createKeyedJoiner<PlaybackResolveWorkOutput, ResolveWorkContext>();

  constructor(
    private readonly coordinator: ResolveCoordinator,
    private readonly options: {
      readonly onCompletedLedger?: (ledger: ResolveWorkLedgerSnapshot) => void;
    } = {},
  ) {}

  async resolve(
    input: PlaybackResolveInput,
    request: PlaybackResolveWorkRequest,
  ): Promise<PlaybackResolveWorkOutput> {
    const freshnessPolicy = freshnessPolicyForInput(input);
    const identity = {
      title: input.title,
      episode: input.episode,
      mode: input.mode,
      providerId: input.providerId,
      audioPreference: input.audioPreference,
      subtitlePreference: input.subtitlePreference,
      qualityPreference: input.qualityPreference,
      startupPriority: input.startupPriority,
      selectedSourceId: input.selectedSourceId,
      selectedStreamId: input.selectedStreamId,
      purpose: resolveWorkPurposeForIntent(request.intentKind),
      freshnessPolicy,
    } as const;
    const resolveWorkKey = buildResolveWorkKey(identity);
    const consumer: Consumer = { onEvent: input.onEvent, onFeedback: input.onFeedback };

    return this.inFlight
      .join(
        resolveWorkKey,
        (signal, { consumers, ledger }) => {
          const physicalInput: PlaybackResolveInput = {
            ...input,
            signal,
            onEvent: (event) => {
              recordResolveEvent(ledger, event);
              for (const waiting of consumers) waiting.onEvent?.(event);
            },
            onFeedback: (feedback) => {
              for (const waiting of consumers) waiting.onFeedback?.(feedback);
            },
          };
          return this.coordinator.resolve(physicalInput).then((output) => {
            if (output.cacheStatus === "prefetched") recordCacheDecision(ledger, "prefetched");
            if (output.stream?.providerResolveResult) {
              recordProviderInventoryFacts(ledger, output.stream.providerResolveResult);
            }
            const workLedger = finalizeResolveWorkLedger(
              ledger,
              output.stream ? "resolved" : signal.aborted ? "cancelled" : "unavailable",
            );
            this.options.onCompletedLedger?.(workLedger);
            return { ...output, workLedger };
          });
        },
        {
          signal: input.signal,
          context: () => ({
            consumers: new Set<Consumer>(),
            ledger: createResolveWorkLedger({
              identity,
              intent: request.intentKind,
              budgetLane: request.budgetLane,
            }),
          }),
          onJoin: ({ consumers, ledger }, role) => {
            if (role === "follower") {
              recordLedgerJoin(ledger, {
                intent: request.intentKind,
                budgetLane: request.budgetLane,
              });
            }
            consumers.add(consumer);
            return () => consumers.delete(consumer);
          },
        },
      )
      .catch((error) => {
        // A consumer that left sees one AbortError shape, whatever reason it
        // aborted with; the reason itself travels to the physical resolve.
        if (input.signal.aborted) throw abortError();
        throw error;
      });
  }

  async prefetch(
    input: Omit<PlaybackResolveInput, "prefetchedStream">,
    request: Omit<PlaybackResolveWorkRequest, "intentKind"> & { readonly intentKind?: "prefetch" },
  ): Promise<{
    readonly stream: StreamInfo;
    readonly providerId: string;
    readonly cacheProvenance: PlaybackResolveCoordinatorOutput["cacheProvenance"];
  } | null> {
    const output = await this.resolve(input, {
      budgetLane: request.budgetLane,
      intentKind: request.intentKind ?? "prefetch",
    });
    if (!output.stream) return null;
    return {
      stream: { ...output.stream, cacheProvenance: output.cacheProvenance },
      providerId: output.providerId,
      cacheProvenance: output.cacheProvenance,
    };
  }
}

function freshnessPolicyForInput(input: PlaybackResolveInput): ResolveFreshnessPolicy {
  if (input.preferFreshStream === true) return "force-fresh";
  if (input.forceHealthCheck === true) return "validate-before-use";
  return "trust-fresh";
}

function recordResolveEvent(ledger: ResolveWorkLedger, event: PlaybackResolveEvent): void {
  switch (event.type) {
    case "cache-hit":
      recordCacheDecision(ledger, "hit");
      return;
    case "cache-miss":
      recordCacheDecision(ledger, "miss");
      return;
    case "cache-stale":
      recordCacheDecision(ledger, "stale");
      return;
    case "cache-hit-validated":
      recordCacheDecision(ledger, "validated");
      return;
    case "source-inventory-hit":
      recordCacheDecision(ledger, "inventory-hit");
      return;
    case "fresh-source-failed-using-cache":
      recordCacheDecision(ledger, "fresh-failed-cache-fallback");
      return;
    case "attempt":
      recordProviderAttempt(ledger, {
        providerId: event.providerId,
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
      });
      return;
    case "failure":
      recordProviderAttempt(ledger, {
        providerId: event.providerId,
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        outcome: "failure",
        issueClass: event.issue,
      });
      return;
    case "selection-decision":
      recordProviderSelectionDecision(ledger, event.decision);
      return;
    case "cache-health-check":
    case "recovery-decision":
    case "provider-resolve-started":
      return;
  }
}

function abortError(): DOMException {
  return new DOMException("Resolve consumer aborted", "AbortError");
}
