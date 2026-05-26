import type { StreamInfo } from "@/domain/types";

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

type InFlightResolve = {
  readonly abortController: AbortController;
  readonly consumers: Set<Consumer>;
  readonly ledger: ResolveWorkLedger;
  readonly promise: Promise<PlaybackResolveWorkOutput>;
};

export class PlaybackResolveWorkService {
  private readonly inFlight = new Map<string, InFlightResolve>();

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
    const existing = this.inFlight.get(resolveWorkKey);

    if (existing) {
      recordLedgerJoin(existing.ledger, {
        intent: request.intentKind,
        budgetLane: request.budgetLane,
      });
      existing.consumers.add(consumer);
      return this.waitForConsumer(existing, consumer, input.signal);
    }

    if (input.signal.aborted) {
      throw abortError();
    }

    const ledger = createResolveWorkLedger({
      identity,
      intent: request.intentKind,
      budgetLane: request.budgetLane,
    });
    const abortController = new AbortController();
    const consumers = new Set<Consumer>([consumer]);
    const entry = {
      abortController,
      consumers,
      ledger,
      promise: Promise.resolve(null as never),
    } as InFlightResolve;

    const physicalInput: PlaybackResolveInput = {
      ...input,
      signal: abortController.signal,
      onEvent: (event) => {
        recordResolveEvent(ledger, event);
        for (const waiting of consumers) waiting.onEvent?.(event);
      },
      onFeedback: (feedback) => {
        for (const waiting of consumers) waiting.onFeedback?.(feedback);
      },
    };
    const promise = this.coordinator.resolve(physicalInput).then((output) => {
      if (output.cacheStatus === "prefetched") recordCacheDecision(ledger, "prefetched");
      if (output.stream?.providerResolveResult) {
        recordProviderInventoryFacts(ledger, output.stream.providerResolveResult);
      }
      const workLedger = finalizeResolveWorkLedger(
        ledger,
        output.stream ? "resolved" : abortController.signal.aborted ? "cancelled" : "unavailable",
      );
      this.options.onCompletedLedger?.(workLedger);
      return {
        ...output,
        workLedger,
      };
    });
    Object.assign(entry, { promise });
    this.inFlight.set(resolveWorkKey, entry);
    void promise.then(
      () => {
        if (this.inFlight.get(resolveWorkKey) === entry) this.inFlight.delete(resolveWorkKey);
        return undefined;
      },
      () => {
        if (this.inFlight.get(resolveWorkKey) === entry) this.inFlight.delete(resolveWorkKey);
        return undefined;
      },
    );
    return this.waitForConsumer(entry, consumer, input.signal);
  }

  async prefetch(
    input: Omit<PlaybackResolveInput, "prefetchedStream">,
    request: Omit<PlaybackResolveWorkRequest, "intentKind"> & { readonly intentKind?: "prefetch" },
  ): Promise<StreamInfo | null> {
    const output = await this.resolve(input, {
      budgetLane: request.budgetLane,
      intentKind: request.intentKind ?? "prefetch",
    });
    if (!output.stream) return null;
    return { ...output.stream, cacheProvenance: output.cacheProvenance };
  }

  private waitForConsumer(
    entry: InFlightResolve,
    consumer: Consumer,
    signal: AbortSignal,
  ): Promise<PlaybackResolveWorkOutput> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const detach = () => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        entry.consumers.delete(consumer);
      };
      const onAbort = () => {
        detach();
        if (entry.consumers.size === 0) entry.abortController.abort();
        reject(abortError());
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
      entry.promise.then(
        (result) => {
          detach();
          resolve(result);
          return undefined;
        },
        (error) => {
          detach();
          reject(error);
          return undefined;
        },
      );
    });
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
    case "cache-health-check":
    case "recovery-decision":
    case "provider-resolve-started":
      return;
  }
}

function abortError(): DOMException {
  return new DOMException("Resolve consumer aborted", "AbortError");
}
