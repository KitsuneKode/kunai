/**
 * Hosted "Ask AI" for the docs — deliberately optional.
 *
 * The site's default search is a static index matched in the browser: no query
 * ever leaves the device. A hosted answer engine is a different promise — the
 * question goes to a third party — so it is configured off unless both
 * `NEXT_PUBLIC_ASK_AI_ENDPOINT` and `NEXT_PUBLIC_ASK_AI_PUBLIC_KEY` are set, is
 * disclosed inline where it is offered, and is lazy-loaded so a visitor who
 * never opens it never downloads its client.
 *
 * These are NEXT_PUBLIC_* values: the key is the provider's public, index-scoped
 * search key meant to ship in pages — not a secret.
 */

export type AskAiConfig = {
  readonly endpoint: string;
  readonly publicKey: string;
  readonly providerLabel: string;
};

export function askAiConfigFrom(env: Record<string, string | undefined>): AskAiConfig | null {
  const endpoint = env.NEXT_PUBLIC_ASK_AI_ENDPOINT?.trim();
  const publicKey = env.NEXT_PUBLIC_ASK_AI_PUBLIC_KEY?.trim();
  if (!endpoint || !publicKey) return null;
  if (!endpoint.startsWith("https://")) return null;
  return {
    endpoint,
    publicKey,
    providerLabel: env.NEXT_PUBLIC_ASK_AI_PROVIDER?.trim() || "Orama",
  };
}

export const askAi: AskAiConfig | null = askAiConfigFrom(process.env);
