export type SearchStartupRoute =
  | "trending"
  | "recommendation"
  | "calendar"
  | "random"
  | "surprise"
  | "history";

export function shouldDeferBrowseIdleContext({
  query,
  resultCount,
  initialRoute,
  hasPendingCalendarRoute = false,
}: {
  readonly query: string;
  readonly resultCount: number;
  readonly initialRoute?: SearchStartupRoute;
  /**
   * True when this open IS the calendar route. The schedule request must start
   * first and the idle context must never sit in front of the calendar's first
   * frame, so idle work is always deferred to the lazy loader here.
   */
  readonly hasPendingCalendarRoute?: boolean;
}): boolean {
  if (hasPendingCalendarRoute) return true;
  return query.trim().length === 0 && resultCount === 0 && initialRoute === undefined;
}
