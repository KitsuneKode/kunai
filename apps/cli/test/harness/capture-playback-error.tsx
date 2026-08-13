// Captures the failure panel at its SETTLED frame. Reduced motion pins the
// panel to that frame with no clock, so the capture is deterministic and a
// diff in __captures__ means the layout actually moved.
process.env.KUNAI_REDUCED_MOTION = "1";

import { ErrorShell } from "@/app-shell/root-status-shells";
import React from "react";

import { captureSurface } from "./render-capture";

await captureSurface(
  "playback-error",
  <ErrorShell
    message="An unknown error occurred"
    scenario={{ kind: "provider-timeout", providerName: "allmanga", elapsedSec: 12 }}
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
  />,
);
console.log("captured playback error panel");
process.exit(0);
