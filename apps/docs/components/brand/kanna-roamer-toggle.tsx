"use client";

import { Button } from "@/components/ui/button";
import {
  browserRoamerStore,
  readRoamerDismissed,
  setRoamerDismissed,
  subscribeRoamerPreference,
} from "@/lib/roamer-preference";
import { useEffect, useState } from "react";

/**
 * The durable way back, on the page about her.
 *
 * The undo that follows a dismissal expires, and `?kanna=on` only helps someone
 * who already knows it exists. This is the answer to "where do I see the state
 * and change it" — and the page named after her is the one place a reader would
 * think to look. It writes the same flag through the same module the roamer
 * reads, and the roamer is subscribed, so flipping it here moves her on the
 * page behind this one without a reload.
 *
 * The two things that decide whether a fox is on screen are tracked separately
 * on purpose. Folding them into one status made the button lie: on a touch
 * device the label is derived from the environment, so clicking it changed the
 * stored preference and nothing visible moved.
 */

/** Whether this browser would roam her at all, ignoring what the reader asked for. */
type Capability = "unknown" | "yes" | "no";

function describe(capability: Capability, dismissed: boolean | null): string {
  if (capability === "unknown" || dismissed === null) return "Checking…";
  if (capability === "no") {
    return dismissed
      ? "Kanna is set to hidden. This browser would not roam her anyway — it reports a coarse pointer or reduced motion."
      : "Kanna is welcome here, but this browser reports a coarse pointer or reduced motion, so she does not roam.";
  }
  return dismissed ? "Kanna is hidden on this site." : "Kanna is roaming this site.";
}

export function KannaRoamerToggle() {
  // Both start unresolved rather than at a guess: every input is client-only,
  // and rendering "she is roaming" on the server would flash the wrong answer
  // at every reader whose browser says otherwise.
  const [capability, setCapability] = useState<Capability>("unknown");
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    const finePointer = window.matchMedia("(pointer: fine)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const store = browserRoamerStore();

    const evaluate = () => {
      setCapability(finePointer.matches && !reducedMotion.matches ? "yes" : "no");
      setDismissed(readRoamerDismissed(store));
    };

    evaluate();
    finePointer.addEventListener("change", evaluate);
    reducedMotion.addEventListener("change", evaluate);
    const unsubscribe = subscribeRoamerPreference(evaluate);
    return () => {
      finePointer.removeEventListener("change", evaluate);
      reducedMotion.removeEventListener("change", evaluate);
      unsubscribe();
    };
  }, []);

  // The control stays live even where she cannot roam. The stored preference is
  // real and worth being able to set from whatever machine you are reading on,
  // and withholding the button would be the same one-way door in a politer
  // costume.
  return (
    <div className="border-fd-border bg-fd-card my-6 flex flex-wrap items-center gap-3 rounded-xl border p-4">
      <p className="text-fd-muted-foreground m-0 flex-1 text-sm">
        {describe(capability, dismissed)}
      </p>
      <Button
        type="button"
        variant={dismissed ? "primary" : "outline"}
        size="sm"
        disabled={dismissed === null}
        onClick={() => setRoamerDismissed(!dismissed)}
      >
        {dismissed ? "Bring her back" : "Hide her"}
      </Button>
    </div>
  );
}
