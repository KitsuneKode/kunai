const STREAK_MILESTONES = [3, 7, 14, 30, 50, 100] as const;

export function getNextStreakMilestone(
  currentStreakDays: number,
  lastCelebratedDays = 0,
): number | null {
  const reached = STREAK_MILESTONES.filter(
    (milestone) => milestone <= currentStreakDays && milestone > lastCelebratedDays,
  );
  return reached.at(-1) ?? null;
}
