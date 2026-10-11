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
    // The event is the source of truth for this page view: when localStorage
    // is unavailable the flag was never written, so re-reading it would hide
    // the chip the roamer just asked for.
    const onDismiss = () => setDismissed(true);
    window.addEventListener("kunai:roamer-dismissed", onDismiss);
    return () => window.removeEventListener("kunai:roamer-dismissed", onDismiss);
  }, []);

  if (!dismissed) return null;

  return (
    <button
      type="button"
      className="text-fd-muted-foreground hover:text-fd-accent-foreground hover:bg-fd-accent mt-1 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors"
      onClick={() => {
        // The roamer does not confirm a restore, so hide on dispatch. If she
        // declined (ineligible page), the flag stayed set and the chip returns
        // next mount.
        window.dispatchEvent(new Event("kunai:roamer-restore"));
        setDismissed(false);
      }}
    >
      <IconPaw className="size-3.5" stroke={1.5} />
      Bring Kanna back
    </button>
  );
}
