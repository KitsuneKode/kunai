import type { CountableTitleProviderFailure } from "./TitleProviderHealthService";

export type ProviderHealthErrorClass =
  | CountableTitleProviderFailure
  | "network-offline"
  | "network-limited"
  | "cancelled"
  | "manual-diagnostic";

export type ProviderHealthEvidence = {
  readonly errorClass: ProviderHealthErrorClass;
  readonly sourceId?: string;
  readonly serverId?: string;
  readonly networkConfidence?: "unknown" | "healthy" | "limited" | "offline";
};

export type ProviderHealthWriteDecision =
  | {
      readonly action: "record-failure";
      readonly evidence: ProviderHealthEvidence & {
        readonly errorClass: CountableTitleProviderFailure;
      };
    }
  | {
      readonly action: "skip";
      readonly reason: "network-offline" | "network-limited" | "cancelled" | "manual-diagnostic";
    };

export function decideProviderHealthWrite(
  evidence: ProviderHealthEvidence,
): ProviderHealthWriteDecision {
  switch (evidence.errorClass) {
    case "network-offline":
    case "network-limited":
    case "cancelled":
    case "manual-diagnostic":
      return { action: "skip", reason: evidence.errorClass };
    case "timeout":
    case "no-streams":
    case "dead-stream":
    case "parse":
      return {
        action: "record-failure",
        evidence: { ...evidence, errorClass: evidence.errorClass },
      };
  }
}
