export type QueuePosterResolver = (titleId: string) => string | undefined;

export type QueuePosterSource = {
  /** Look up a persisted poster URL by titleId (history / catalog backed). */
  readonly getPosterUrl: (titleId: string) => string | undefined;
};

/** Pure factory so the resolver is trivially testable and injectable. */
export function createQueuePosterResolver(source: QueuePosterSource): QueuePosterResolver {
  return (titleId: string) => source.getPosterUrl(titleId);
}
