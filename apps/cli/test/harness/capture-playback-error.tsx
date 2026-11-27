// Failure panels are static. Capture their recovery controls without a clock;
// a diff in __captures__ means the layout actually moved.
import { ErrorShell } from "@/app-shell/root-status-shells";
import React from "react";

import { captureSurface } from "./render-capture";

export function playbackErrorNode() {
  return (
    <ErrorShell
      message="The stream did not start."
      scenario={{ kind: "provider-timeout", providerName: "allmanga", elapsedSec: 12 }}
      nextStep={{ text: "press r to try again, or p to pick another source", extra: [] }}
      waterfall={{
        title: "Source attempts",
        truncated: true,
        rows: [
          { label: "search", detail: "0.4s", status: "succeeded" },
          { label: "scrape", detail: "1.1s", status: "succeeded" },
          { label: "resolve", detail: "timed out", status: "failed" },
        ],
      }}
      onResolve={() => {}}
      onRetry={() => {}}
    />
  );
}

if (import.meta.main) {
  process.env.KUNAI_REDUCED_MOTION = "1";
  await captureSurface("playback-error", playbackErrorNode());
  console.log("captured playback error panel");
  process.exit(0);
}
