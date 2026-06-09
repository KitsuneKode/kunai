/** True when we should seek / pass --start for a resume position (any positive second). */
export function shouldApplyStartAtSeek(startAt: number | undefined): boolean {
  return typeof startAt === "number" && Number.isFinite(startAt) && startAt > 0;
}
