import {
  classifyNetworkFailure,
  type NetworkEvidence,
  type NetworkSnapshot,
} from "./NetworkStatus";

/**
 * Reactive connectivity seam: user intent (offline mode) AND runtime network reality.
 * Single source of truth for "can Kunai do online work right now?"
 */
export class Connectivity {
  private readonly subscribers = new Set<() => void>();
  private snapshot: NetworkSnapshot = {
    status: "online",
    checkedAt: Date.now(),
    evidence: "startup-probe",
  };

  constructor(private readonly getOfflineMode: () => boolean) {}

  /** Whether online provider/search work is allowed right now. */
  isOnline(): boolean {
    if (this.getOfflineMode()) return false;
    return this.snapshot.status === "online" || this.snapshot.status === "limited";
  }

  getSnapshot(): NetworkSnapshot {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  /** Call when persisted config affecting connectivity changes (e.g. offlineMode toggle). */
  notifyIntentChanged(): void {
    this.notify();
  }

  recordSuccess(evidence: NetworkEvidence = "startup-probe", message?: string): void {
    if (this.getOfflineMode()) return;
    this.snapshot = {
      status: "online",
      checkedAt: Date.now(),
      evidence,
      message,
    };
    this.notify();
  }

  recordFailure(message: string, evidence: NetworkEvidence): void {
    if (this.getOfflineMode()) return;
    const status = classifyNetworkFailure(message);
    this.snapshot = {
      status: status === "unknown" ? "limited" : status,
      checkedAt: Date.now(),
      evidence,
      message,
    };
    this.notify();
  }

  private notify(): void {
    for (const listener of this.subscribers) {
      listener();
    }
  }
}
