"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/**
 * Makes every Motion animation on the site honour `prefers-reduced-motion`.
 *
 * The stylesheet's reduced-motion block only reaches CSS animations and transitions.
 * Motion drives its own animations from JavaScript, so a section heading kept sliding
 * 12px and the demo palette kept springing for people who had asked the OS for less
 * movement. `reducedMotion="user"` drops transform and layout animation under that
 * setting and keeps opacity, which is the "gentler, not zero" behaviour the rest of
 * the site follows.
 */
export function MotionProvider({ children }: { readonly children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
