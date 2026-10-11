"use client";

import { filterPrivateShareAnalytics } from "@/lib/analytics-privacy";
import { SpeedInsights } from "@vercel/speed-insights/next";

export function PrivacySpeedInsights() {
  return <SpeedInsights beforeSend={filterPrivateShareAnalytics} />;
}
