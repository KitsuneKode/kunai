import type { NotificationPriority } from "./notification-queue";
import type { ShellStatusTone } from "./types";

export type TransientToneLine = { readonly text: string; readonly tone: ShellStatusTone };

export type TransientRowInput = {
  readonly alert: TransientToneLine | null;
  readonly notificationToast: string | null;
  /** Immediate arrivals can briefly preempt standing playback alerts. */
  readonly notificationToastPriority?: NotificationPriority | null;
  readonly streakMilestoneAlert: string | null;
  readonly presenceBootLine: TransientToneLine | null;
  readonly streakAtRiskAlert: string | null;
  readonly weeklyDigestLine: string | null;
};

export type TransientRowLine = {
  readonly text: string;
  readonly tone: ShellStatusTone;
  /** Bright accent (a fresh notification arrival) — overrides the tone color. */
  readonly accent: boolean;
  /** Render dim (calm/info) vs full intensity. */
  readonly dim: boolean;
};

// The shell reserves ONE transient row; exactly one line wins, by priority:
// genuine alert → notification arrival toast → streak milestone → presence boot →
// streak-at-risk → weekly digest. Arrivals render bright; calm infos dim. Keeping
// this pure makes the priority testable without mounting the whole shell.
export function selectTransientRow(input: TransientRowInput): TransientRowLine | null {
  if (input.notificationToast && input.notificationToastPriority === "immediate") {
    return { text: input.notificationToast, tone: "info", accent: true, dim: false };
  }
  if (input.alert) {
    return { text: input.alert.text, tone: input.alert.tone, accent: false, dim: true };
  }
  if (input.notificationToast) {
    return { text: input.notificationToast, tone: "info", accent: true, dim: false };
  }
  if (input.streakMilestoneAlert) {
    return { text: input.streakMilestoneAlert, tone: "warning", accent: false, dim: true };
  }
  if (input.presenceBootLine) {
    const calm =
      input.presenceBootLine.tone !== "error" && input.presenceBootLine.tone !== "warning";
    return {
      text: input.presenceBootLine.text,
      tone: input.presenceBootLine.tone,
      accent: false,
      dim: calm,
    };
  }
  if (input.streakAtRiskAlert) {
    return { text: input.streakAtRiskAlert, tone: "warning", accent: false, dim: true };
  }
  if (input.weeklyDigestLine) {
    return { text: input.weeklyDigestLine, tone: "info", accent: false, dim: true };
  }
  return null;
}
