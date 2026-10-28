import type { ReleaseAvailabilityDiagnostic } from "../live/release-provider-signoff";

/** Synthetic observed absence, used only by network-free gate fixtures. */
export function releaseAvailabilityFixture(provider = "videasy"): ReleaseAvailabilityDiagnostic[] {
  return [
    {
      lane: "movie",
      targetId: "438631",
      targetTitle: "Dune",
      provider,
      status: "not-found",
      verifiedNotFound: true,
      resolved: false,
      streamCandidates: 0,
      streamReachable: null,
      failureClass: null,
      durationMs: 100,
    },
  ];
}
