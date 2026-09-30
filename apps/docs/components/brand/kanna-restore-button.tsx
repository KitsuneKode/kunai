"use client";

import { IconPaw } from "@tabler/icons-react";
import { useEffect, useState } from "react";

const STORAGE_KEY = "kunai.roamer.dismissed";

/**
 * The way back for "dismiss Kanna". Renders nothing until mount confirms she
 * was dismissed — server and client then agree on the empty first paint — and
 * hides again the moment she returns. Dispatching `kunai:roamer-restore` lets
 * the roamer clear the flag and walk again without a reload.
 */
export function KannaRestoreButton() {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const read = () => {
      try {
        setDismissed(window.localStorage.getItem(STORAGE_KEY) === "1");
      } catch {
        setDismissed(false);
      }
    };
    read();
    // If she is dismissed in this tab after mount, the chip should appear
    // without a reload — watch for the flag being set by the roamer's close.
    const onDismiss = () => read();
    window.addEventListener("kunai:roamer-dismissed", onDismiss);
    return () => window.removeEventListener("kunai:roamer-dismissed", onDismiss);
  }, []);

  if (!dismissed) return null;

  return (
    <button
      type="button"
      className="text-fd-muted-foreground hover:text-fd-accent-foreground hover:bg-fd-accent mt-1 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors"
      onClick={() => window.dispatchEvent(new Event("kunai:roamer-restore"))}
    >
      <IconPaw className="size-3.5" stroke={1.5} />
      Bring Kanna back
    </button>
  );
}
