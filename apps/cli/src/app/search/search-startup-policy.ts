export type SearchStartupRoute =
  | "trending"
  | "recommendation"
  | "calendar"
  // The schedule opened on its Anime or Series tab, as the browse commands do.
  | "anime-calendar"
  | "series-calendar"
  | "random"
  | "surprise"
  | "history";

/** Startup routes that open the schedule, on the tab the name says. */
export type CalendarStartupRoute = Extract<
  SearchStartupRoute,
  "calendar" | "anime-calendar" | "series-calendar"
>;

export function isCalendarStartupRoute(
  route: SearchStartupRoute | undefined,
): route is CalendarStartupRoute {
  return route === "calendar" || route === "anime-calendar" || route === "series-calendar";
}

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
