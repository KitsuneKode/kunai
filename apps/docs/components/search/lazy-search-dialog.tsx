"use client";

import type { SharedProps } from "fumadocs-ui/components/dialog/search";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

type LazySearchDialogProps = SharedProps & {
  readonly api?: string;
  readonly delayMs?: number;
};

/**
 * The real dialog, fetched on demand.
 *
 * It pulls in the search client and the Orama matcher, about 265 KB of JavaScript,
 * and used to be imported straight into the root layout, so every page on the site
 * downloaded and parsed it before anyone had pressed a key. It is only ever needed
 * after the visitor opens search, so it now loads then.
 */
const KunaiSearchDialog = dynamic(
  () => import("./kunai-search-dialog").then((module) => module.KunaiSearchDialog),
  { ssr: false },
);

/** Any of these means a person is here and about to use the page. */
const WARM_EVENTS = ["pointerdown", "keydown", "touchstart"] as const;

/**
 * Mounts the search dialog the first time it is opened, then keeps it mounted so its
 * downloaded index and typed query survive closing and reopening.
 *
 * Opening it cold would wait on the chunk, so the first real input anywhere on the
 * page starts the download. That keeps Ctrl+K instant for someone who is actually
 * using the site, while a load that never receives input (a crawler, a Lighthouse
 * run, a tab left in the background) never pays for it.
 */
export function LazySearchDialog(props: LazySearchDialogProps) {
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    if (props.open) setRequested(true);
  }, [props.open]);

  useEffect(() => {
    const warm = () => void import("./kunai-search-dialog");
    for (const event of WARM_EVENTS) {
      window.addEventListener(event, warm, { once: true, passive: true });
    }
    return () => {
      for (const event of WARM_EVENTS) window.removeEventListener(event, warm);
    };
  }, []);

  if (!requested && !props.open) return null;
  return <KunaiSearchDialog {...props} />;
}
