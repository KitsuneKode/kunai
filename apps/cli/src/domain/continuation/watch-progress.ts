export type WatchProgressInput = {
  readonly timestamp?: number;
  readonly duration?: number;
  readonly completed?: boolean;
};

export type WatchProgressProjection = {
  readonly percentage: number | null;
  readonly completed: boolean;
  readonly inProgress: boolean;
};

export function projectWatchProgress(input: WatchProgressInput): WatchProgressProjection {
  const completed = input.completed === true;
  const timestamp = finiteNonNegative(input.timestamp);
  const duration = finitePositive(input.duration);

  if (!duration) {
    return {
      percentage: completed ? 100 : null,
      completed,
      inProgress: !completed && Boolean(timestamp && timestamp > 10),
    };
  }

  const rawPercentage = Math.round(((timestamp ?? 0) / duration) * 100);
  const percentage = completed ? 100 : Math.max(1, Math.min(99, rawPercentage));
  const inferredCompleted = completed || rawPercentage >= 95;
  return {
    percentage: inferredCompleted ? 100 : percentage,
    completed: inferredCompleted,
    inProgress: !inferredCompleted && Boolean(timestamp && timestamp > 10),
  };
}

function finiteNonNegative(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : null;
}

function finitePositive(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}
