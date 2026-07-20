export type SoftFallbackResolveDecision =
  | { readonly kind: "no-hop" }
  | { readonly kind: "session-soft-hop"; readonly providerId: string };

export type SoftFallbackPromoteDecision =
  | { readonly kind: "leave-durable-unchanged" }
  | {
      readonly kind: "promote-durable";
      readonly providerId: string;
      readonly canonicalTitleId: string;
    };

export function decideSoftFallbackOnResolve(input: {
  readonly configuredProviderId: string;
  readonly resolvedProviderId: string;
}): SoftFallbackResolveDecision {
  if (input.resolvedProviderId === input.configuredProviderId) {
    return { kind: "no-hop" };
  }
  return { kind: "session-soft-hop", providerId: input.resolvedProviderId };
}

export function decideSoftFallbackPromote(input: {
  readonly sessionSoftProviderId: string | null;
  readonly configuredProviderId: string;
  readonly engaged: boolean;
  readonly canonicalTitleId: string;
}): SoftFallbackPromoteDecision {
  if (!input.engaged || !input.sessionSoftProviderId) {
    return { kind: "leave-durable-unchanged" };
  }
  if (input.sessionSoftProviderId === input.configuredProviderId) {
    return { kind: "leave-durable-unchanged" };
  }
  return {
    kind: "promote-durable",
    providerId: input.sessionSoftProviderId,
    canonicalTitleId: input.canonicalTitleId,
  };
}
