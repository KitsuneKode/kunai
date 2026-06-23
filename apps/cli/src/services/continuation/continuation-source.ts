import type { ContinuationAction, ContinuationProjection } from "./continuation-policy";

export type ContinueSourcePreference = "auto" | "local" | "stream" | "ask";

export function localActionFromProjection(
  projection: ContinuationProjection | undefined,
): Extract<ContinuationAction, { readonly kind: "play-local" }> | undefined {
  const actions = [projection?.primaryAction, ...(projection?.secondaryActions ?? [])];
  return actions.find(
    (action): action is Extract<ContinuationAction, { readonly kind: "play-local" }> =>
      action?.kind === "play-local",
  );
}

export function onlineActionFromProjection(
  projection: ContinuationProjection | undefined,
): Extract<ContinuationAction, { readonly kind: "resume" | "select-online" }> | undefined {
  const actions = [projection?.primaryAction, ...(projection?.secondaryActions ?? [])];
  return actions.find(
    (
      action,
    ): action is Extract<ContinuationAction, { readonly kind: "resume" | "select-online" }> =>
      action?.kind === "resume" || action?.kind === "select-online",
  );
}

export function hasDualContinueSources(projection: ContinuationProjection | undefined): boolean {
  return Boolean(localActionFromProjection(projection) && onlineActionFromProjection(projection));
}

export function resolveContinueSourceAction(
  projection: ContinuationProjection | undefined,
  preference: ContinueSourcePreference,
  override?: "local" | "stream",
): ContinuationAction | undefined {
  const local = localActionFromProjection(projection);
  const online = onlineActionFromProjection(projection);
  if (override === "local" && local) return local;
  if (override === "stream" && online) return online;
  if (!local && !online) return projection?.primaryAction;
  if (local && !online) return local;
  if (online && !local) return online;
  switch (preference) {
    case "local":
      return local;
    case "stream":
      return online;
    case "auto":
      return local ?? online;
    case "ask":
      return undefined;
  }
}

export function resumeLabelForProjection(
  projection: ContinuationProjection | undefined,
  bucket: "continue" | "new-episodes" | "completed",
): string {
  const action = resolveContinueSourceAction(projection, "auto");
  if (action?.kind === "play-local") return "Play local";
  if (action?.kind === "resume") return "Continue";
  if (action?.kind === "select-online") {
    return bucket === "new-episodes" ? "Play next" : "Stream";
  }
  if (projection?.kind === "offline-ready") return "Play local";
  if (projection?.kind === "new-episodes") return "Play next";
  if (projection?.kind === "resume-unfinished") return "Continue";
  if (projection?.kind === "next-released") return "Play next";
  return "Open";
}
