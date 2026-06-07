// =============================================================================
// share-code.ts — encode/decode a "watch this" share code for a title (+episode).
//
// A code is `kunai1:<base64url(JSON)>`. Self-contained and offline: the receiver
// decodes it back into enough identity to resolve + play the same title. No URLs
// today (web handoff is a later layer); the code travels over any channel.
// =============================================================================

const SHARE_CODE_PREFIX = "kunai1:";

export type ShareCodePayload = {
  readonly id: string;
  readonly type: "movie" | "series";
  readonly name: string;
  readonly season?: number;
  readonly episode?: number;
};

export function encodeShareCode(payload: ShareCodePayload): string {
  const compact: ShareCodePayload = {
    id: payload.id,
    type: payload.type,
    name: payload.name,
    ...(typeof payload.season === "number" ? { season: payload.season } : {}),
    ...(typeof payload.episode === "number" ? { episode: payload.episode } : {}),
  };
  return SHARE_CODE_PREFIX + Buffer.from(JSON.stringify(compact), "utf8").toString("base64url");
}

export function decodeShareCode(raw: string): ShareCodePayload | null {
  const trimmed = raw.trim();
  // Accept a bare code or one embedded in surrounding text the user pasted.
  const match = trimmed.match(/kunai1:[A-Za-z0-9_-]+/);
  if (!match) return null;
  try {
    const json = Buffer.from(match[0].slice(SHARE_CODE_PREFIX.length), "base64url").toString(
      "utf8",
    );
    const parsed = JSON.parse(json) as Partial<ShareCodePayload>;
    if (
      typeof parsed.id !== "string" ||
      parsed.id.length === 0 ||
      (parsed.type !== "movie" && parsed.type !== "series") ||
      typeof parsed.name !== "string"
    ) {
      return null;
    }
    return {
      id: parsed.id,
      type: parsed.type,
      name: parsed.name,
      ...(typeof parsed.season === "number" ? { season: parsed.season } : {}),
      ...(typeof parsed.episode === "number" ? { episode: parsed.episode } : {}),
    };
  } catch {
    return null;
  }
}
