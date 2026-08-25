"use client";

import { filterPrivateShareAnalytics } from "@/lib/analytics-privacy";
import { Analytics } from "@vercel/analytics/next";

export function PrivacyAnalytics() {
  return <Analytics beforeSend={filterPrivateShareAnalytics} />;
}
