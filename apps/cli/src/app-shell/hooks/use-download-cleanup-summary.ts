import type { Container } from "@/container";
import {
  collectDownloadCleanupCandidates,
  formatCleanupBannerText,
  summarizeDownloadCleanupCandidates,
  type DownloadCleanupSummary,
} from "@/services/download/download-cleanup-candidates";
import { useEffect, useState } from "react";

/**
 * Live count/size of watched-download cleanup candidates for the library and
 * download surfaces. `null` means "nothing to show" — either no candidates or
 * `autoCleanupWatched` is off — so callers render no banner at all.
 *
 * Recomputes on every download event (enqueued/complete/deleted fire through
 * `downloadService.onEvent`), which covers the lifecycle transitions that can
 * change the candidate set while the surface is open.
 */
export function useDownloadCleanupSummary(container: Container): DownloadCleanupSummary | null {
  const [summary, setSummary] = useState<DownloadCleanupSummary | null>(null);

  useEffect(() => {
    const refresh = () => {
      const next = summarizeDownloadCleanupCandidates(collectDownloadCleanupCandidates(container));
      setSummary((current) => {
        const resolved = next.count > 0 ? next : null;
        if (current?.count === resolved?.count && current?.totalBytes === resolved?.totalBytes) {
          return current;
        }
        return resolved;
      });
    };
    refresh();
    return container.downloadService.onEvent(refresh);
  }, [container]);

  return summary;
}

export { formatCleanupBannerText };
