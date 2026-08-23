import generated from "./generated-troubleshooting-faq.json";

export type TroubleshootingFaqEntry = {
  readonly question: string;
  readonly answer: string;
};

/**
 * The FAQ rendered as JSON-LD on `/docs/users/troubleshooting`.
 *
 * Parsed out of `docs/` at build time by `scripts/sync-repo-content.ts` — the
 * reading and parsing live there, this module is only the typed handle on the
 * result. See that script's header for why the runtime must not read `docs/`
 * itself.
 */
export const troubleshootingFaqEntries = generated as readonly TroubleshootingFaqEntry[];
