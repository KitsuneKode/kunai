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
  if (status === 200) return "current";
  if (body.includes("unknown_build_id")) return "build-id-rotated";
  if (body.includes("invalid_boot_token")) return "derivation-constants-rotated";
  if (body.includes("missing_build_id") || body.includes("missing_or_invalid_lane")) {
    return "request-shape";
  }
  // Cloudflare answers with an HTML challenge page rather than the API's JSON.
  if (body.trimStart().startsWith("<")) return "blocked";
  return "unreachable";
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
