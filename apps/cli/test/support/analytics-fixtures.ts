import type { PingLog, PingLogEntry } from "@/services/analytics/ping-log";
import {
  describeAnalyticsPayload,
  type AnalyticsPayload,
} from "@/services/analytics/usage-analytics-service";

/** An in-memory `PingLog`, so no test writes the real data dir. */
export function memoryPingLog(): PingLog & {
  readonly entries: readonly PingLogEntry[];
  readonly exists: boolean;
} {
  let entries: PingLogEntry[] = [];
  let exists = false;
  return {
    get entries() {
      return entries;
    },
    get exists() {
      return exists;
    },
    async append(entry) {
      entries = [...entries, entry];
      exists = true;
    },
    async read() {
      return entries;
    },
    async remove() {
      entries = [];
      exists = false;
    },
  };
}

/**
 * What the consent screen shows a fresh install, on a fixed clock and host, so
 * a rendered frame or a committed capture never changes with the date.
 */
export const UNSET_PAYLOAD_FIXTURE: AnalyticsPayload = describeAnalyticsPayload({
  identity: { analytics: "unset", installId: "", analyticsCohort: "" },
  version: "0.4.0",
  platform: { os: "linux", arch: "x64" },
  now: Date.UTC(2026, 10, 25, 12),
});
