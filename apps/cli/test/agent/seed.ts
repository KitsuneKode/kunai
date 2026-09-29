/**
 * The default "returning user" profile seed shared by every agent driver.
 * Written as a real config.json (not flags): completed setup, fixture-default
 * providers, and analytics explicitly DECLINED — the privacy contract's
 * safest state. Deliberately sparse: the app's own first save fills defaults,
 * which is also what makes a missing write detectable (6 keys → ~89).
 *
 * NOTE: do NOT seed offlineMode. offlineMode + empty search query makes
 * SearchPhase return cancelled synchronously and the session loop retries in
 * a pure-microtask livelock — a real bug the harness found; seeding it would
 * hang every session.
 */
import { ONBOARDING_VERSION } from "@/app/bootstrap/startup-setup";

export function onboardedConfig(): Record<string, unknown> {
  return {
    // Imported, not hardcoded: the seed tracks the current wizard revision so
    // a bump can never silently drag the harness back through onboarding.
    onboardingVersion: ONBOARDING_VERSION,
    downloadOnboardingDismissed: true,
    provider: "videasy",
    animeProvider: "allanime",
    // Explicit decline — hazard 3. Never "unset": an unset state is what makes
    // the real shell raise the disclosure banner and schedule markNoticeShown.
    analytics: "disabled",
    installId: "",
  };
}
