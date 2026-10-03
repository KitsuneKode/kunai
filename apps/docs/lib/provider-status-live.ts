import type { JsonValue } from "@kunai/types";

import {
  bundledHistory,
  bundledNotices,
  bundledStatus,
  chooseHistory,
  chooseStatus,
  parseHistory,
  parseNotices,
  parseStatusFile,
  type ProviderStatusFile,
  type StatusHistory,
  type StatusNotices,
  type StatusSource,
} from "./provider-status";

/**
 * The live copy of the status data, fetched at render and cached.
 *
 * The daily sweep publishes to the `status-data` branch, not to `main` and not
 * into a release. The site reads it from there with ten minutes of caching, so
 * a fresh result, or a notice a maintainer has just written, shows within minutes
 * and no deploy is involved. Before this the board was baked in at build time, so
 * it was only as new as the last time anyone shipped the docs.
 *
 * Every failure resolves to the bundled seed instead of an error: a rate-limited or
 * unreachable GitHub must leave a page that still renders, with its freshness line
 * telling the visitor how old the result really is. Live data never wins by being
 * live: `chooseStatus` takes the newer of the two by its own timestamp.
 *
 * `KUNAI_STATUS_DATA_URL` points the page at a different base, for trying a
 * branch or a fixture without touching the real one.
 */
const DEFAULT_STATUS_DATA_BASE = "https://raw.githubusercontent.com/KitsuneKode/kunai/status-data";

/**
 * Where the three documents are fetched from. Read when it is needed, not once at
 * module load, so a test or a preview can point the page somewhere else.
 */
export function statusDataBase(): string {
  return (process.env.KUNAI_STATUS_DATA_URL?.trim() || DEFAULT_STATUS_DATA_BASE).replace(/\/$/, "");
}

/** How long a fetched copy is reused before the next render asks again. */
export const STATUS_REVALIDATE_SECONDS = 600;

export const STATUS_FILES = {
  status: "generated-provider-status.json",
  history: "generated-provider-status-history.json",
  notices: "status-notices.json",
} as const;

async function fetchJson(name: string): Promise<JsonValue | null> {
  try {
    const response = await fetch(`${statusDataBase()}/${name}`, {
      signal: AbortSignal.timeout(5000),
      next: { revalidate: STATUS_REVALIDATE_SECONDS },
    });
    if (!response.ok) return null;
    // `response.json()` is untyped; every document goes through its parser before use.
    const body: JsonValue = await response.json();
    return body;
  } catch {
    return null;
  }
}

export type LoadedProviderStatus = {
  readonly file: ProviderStatusFile;
  readonly history: StatusHistory;
  readonly notices: StatusNotices;
  /** Where the latest result came from. */
  readonly source: StatusSource;
};

export async function loadProviderStatus(): Promise<LoadedProviderStatus> {
  const [statusRaw, historyRaw, noticesRaw] = await Promise.all([
    fetchJson(STATUS_FILES.status),
    fetchJson(STATUS_FILES.history),
    fetchJson(STATUS_FILES.notices),
  ]);

  const { file, source } = chooseStatus(
    bundledStatus,
    statusRaw === null ? null : parseStatusFile(statusRaw),
  );
  const history = chooseHistory(
    bundledHistory,
    historyRaw === null ? null : parseHistory(historyRaw),
  );
  // Notices have no timestamp of their own to compare, and they are the one document
  // that exists to be edited without a release, so a valid live copy always wins.
  const notices = (noticesRaw === null ? null : parseNotices(noticesRaw)) ?? bundledNotices;

  return { file, history, notices, source };
}
