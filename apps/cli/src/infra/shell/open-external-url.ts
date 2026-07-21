import {
  defaultExternalOpenRuntime,
  isExternalOpenDisabled,
  openExternal,
  type ExternalOpenResult,
  type ExternalOpenRuntime,
} from "@/infra/os/external-open";

export type { ExternalOpenResult, ExternalOpenRuntime };

/** Default docs target when `KUNAI_DOCS_URL` is unset. Override in prod via env. */
export function defaultKunaiDocsUrl(): string {
  return process.env.KUNAI_DOCS_URL ?? "https://github.com/KitsuneKode/kunai/tree/main/docs";
}

/** True when external browser/file openers must not run (tests, CI, headless). */
export function isExternalUrlOpeningDisabled(): boolean {
  return isExternalOpenDisabled();
}

/**
 * Open a URL in the user's default browser with a platform-correct opener.
 * Returns a typed result; never throws on spawn/`exited` failures.
 * No-ops with `reason: "disabled"` when `KUNAI_DISABLE_EXTERNAL_URL=1`.
 */
export async function openExternalUrl(
  url: string,
  runtime: ExternalOpenRuntime = defaultExternalOpenRuntime,
): Promise<ExternalOpenResult> {
  return openExternal({ kind: "url", url }, runtime);
}

/** Awaitable opener alias for workflow commands that need the typed result. */
export async function openExternalUrlAndWait(
  url: string,
  runtime: ExternalOpenRuntime = defaultExternalOpenRuntime,
): Promise<ExternalOpenResult> {
  return openExternalUrl(url, runtime);
}
