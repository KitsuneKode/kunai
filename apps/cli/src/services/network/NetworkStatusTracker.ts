import {
  classifyNetworkFailure,
  type NetworkEvidence,
  type NetworkSnapshot,
  type NetworkStatus,
} from "./NetworkStatus";

export class NetworkStatusTracker {
  private snapshot: NetworkSnapshot = {
    status: "online",
    checkedAt: Date.now(),
    evidence: "startup-probe",
  };

  getSnapshot(): NetworkSnapshot {
    return this.snapshot;
  }

  isAvailable(): boolean {
    return this.snapshot.status === "online" || this.snapshot.status === "limited";
  }

  recordSuccess(evidence: NetworkEvidence = "startup-probe", message?: string): void {
    this.snapshot = {
      status: "online",
      checkedAt: Date.now(),
      evidence,
      message,
    };
  }

  recordFailure(message: string, evidence: NetworkEvidence): void {
    const status = classifyNetworkFailure(message);
    this.snapshot = {
      status: status === "unknown" ? "limited" : status,
      checkedAt: Date.now(),
      evidence,
      message,
    };
  }

  forceStatus(status: NetworkStatus, evidence: NetworkEvidence, message?: string): void {
    this.snapshot = {
      status,
      checkedAt: Date.now(),
      evidence,
      message,
    };
  }
}
