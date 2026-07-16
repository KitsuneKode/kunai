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
}: {
  readonly query: string;
  readonly resultCount: number;
  readonly initialRoute?: SearchStartupRoute;
}): boolean {
  return query.trim().length === 0 && resultCount === 0 && initialRoute === undefined;
}
