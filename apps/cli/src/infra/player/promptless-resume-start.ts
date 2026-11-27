export function promptlessResumeStartAt(input: {
  readonly startAt?: number;
  readonly resumePromptAt?: number;
  readonly resumeStartChoicePrompt?: boolean;
  readonly resumeOfferOverlayOnly?: boolean;
}): number | undefined {
  const explicitStart = input.startAt ?? 0;
  if (explicitStart > 0 && Number.isFinite(explicitStart)) return input.startAt;
  if (input.resumeStartChoicePrompt === false) return input.startAt;
  // Restart: the offer is the persistent overlay's, not a start position.
  if (input.resumeOfferOverlayOnly) return input.startAt;
  const offeredStart = input.resumePromptAt ?? 0;
  if (offeredStart > 0 && Number.isFinite(offeredStart)) return input.resumePromptAt;
  return input.startAt;
}
