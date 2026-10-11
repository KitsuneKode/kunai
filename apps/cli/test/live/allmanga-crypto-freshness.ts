/**
 * Reading mkissa's bootstrap answer as a diagnosis.
 *
 * The endpoint distinguishes *which half* of the pinned crypto is stale, which
 * turns the next rotation from a reverse-engineering session into a lookup. The
 * mapping is the valuable part, so it lives here and is unit-tested rather than
 * being buried in the smoke.
 */
export type AllMangaCryptoDiagnosis =
  | "current"
  | "build-id-rotated"
  | "derivation-constants-rotated"
  | "request-shape"
  | "blocked"
  | "unreachable";

export function diagnoseAllMangaBootstrap(status: number, body: string): AllMangaCryptoDiagnosis {
  // A 200 alone proves nothing: an interstitial or maintenance page answers 200
  // with HTML, and calling that "current" hides a blocked bootstrap as healthy.
  // The bootstrap payload is the evidence, so require it.
  if (status === 200) return isBootstrapPayload(body) ? "current" : "blocked";
  if (body.includes("unknown_build_id")) return "build-id-rotated";
  if (body.includes("invalid_boot_token")) return "derivation-constants-rotated";
  if (body.includes("missing_build_id") || body.includes("missing_or_invalid_lane")) {
    return "request-shape";
  }
  // Cloudflare answers with an HTML challenge page rather than the API's JSON.
  if (body.trimStart().startsWith("<")) return "blocked";
  return "unreachable";
}

export type AllMangaBootstrapAttempt = {
  readonly epoch: number;
  readonly status: number;
  readonly body: string;
};

/**
 * Pick the bootstrap attempt that actually worked.
 *
 * Near an epoch boundary the client signs both the epoch that just ended and
 * the one that just began (`currentAllMangaEpochCandidates`). The server keeps
 * honouring the previous epoch for the grace window, so asking *only* the
 * calendar epoch returns `invalid_boot_token` while production — which walks
 * the same candidate list — is still healthy. The first `current` diagnosis
 * wins; if none of them worked, the live (last) epoch's diagnosis stands.
 */
export function selectAllMangaBootstrapVerdict(
  attempts: readonly AllMangaBootstrapAttempt[],
): AllMangaBootstrapAttempt & { readonly diagnosis: AllMangaCryptoDiagnosis } {
  const diagnosed = attempts.map((attempt) => ({
    ...attempt,
    diagnosis: diagnoseAllMangaBootstrap(attempt.status, attempt.body),
  }));
  const current = diagnosed.find((attempt) => attempt.diagnosis === "current");
  if (current) return current;
  return (
    diagnosed.at(-1) ?? {
      epoch: 0,
      status: 0,
      body: "",
      diagnosis: "unreachable" as const,
    }
  );
}

/** A real bootstrap answer carries the epoch and the key half it exists to hand back. */
function isBootstrapPayload(body: string): boolean {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object") return false;
    const record = parsed as Record<string, unknown>;
    return typeof record.partB === "string" && typeof record.epoch === "number";
  } catch {
    return false;
  }
}

export function allMangaCryptoRemedy(
  diagnosis: AllMangaCryptoDiagnosis,
  epochsBehind: number,
): string | undefined {
  switch (diagnosis) {
    case "build-id-rotated":
      return "Scan build ids until the answer flips to invalid_boot_token, then re-extract from the crypto chunk (see the AllManga dossier)";
    case "derivation-constants-rotated":
      return "Build id is current; re-extract Rf (saltMul/saltAdd/fragMul/fragAdd/bootPrefix/join/parts) and the mask fragments";
    case "request-shape":
      return "A query param was dropped — the request needs ?buildId=&k=<lane>";
    case "blocked":
      return "Send Referer and Origin https://mkissa.to";
    case "current":
      return epochsBehind > 1
        ? "Bootstrap works but BUNDLED_ALLMANGA_CRYPTO is stale; refresh the bundled epoch and key"
        : undefined;
    default:
      return undefined;
  }
}
