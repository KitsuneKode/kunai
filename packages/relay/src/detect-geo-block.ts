export interface GeoBlockDetectionInput {
  readonly providerId?: string;
  readonly upstreamUrl?: string;
  readonly status?: number;
  readonly body?: string;
}

export interface GeoBlockDetection {
  readonly blocked: boolean;
  readonly reason?: "need-captcha" | "turnstile" | "forbidden-empty-graphql";
  readonly relaySuggested: boolean;
}

const GEO_BLOCK_PATTERNS = [
  { reason: "need-captcha", pattern: /NEED_CAPTCHA|need[_\s-]?captcha/i },
  { reason: "turnstile", pattern: /cf-turnstile|turnstile challenge/i },
] as const;

const RELAY_SUGGESTION_PROVIDERS = new Set(["allanime", "allmanga"]);

export function detectGeoBlockedProviderResponse(input: GeoBlockDetectionInput): GeoBlockDetection {
  const body = input.body ?? "";
  for (const candidate of GEO_BLOCK_PATTERNS) {
    if (candidate.pattern.test(body)) {
      return {
        blocked: true,
        reason: candidate.reason,
        relaySuggested: shouldSuggestRelay(input.providerId),
      };
    }
  }

  if (
    input.status === 403 &&
    input.upstreamUrl?.includes("api.allanime.day") &&
    body.trim().length === 0
  ) {
    return {
      blocked: true,
      reason: "forbidden-empty-graphql",
      relaySuggested: shouldSuggestRelay(input.providerId),
    };
  }

  return { blocked: false, relaySuggested: false };
}

function shouldSuggestRelay(providerId: string | undefined): boolean {
  return providerId ? RELAY_SUGGESTION_PROVIDERS.has(providerId) : false;
}
