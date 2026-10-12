import type { NotificationPriority } from "./notification-queue";
import type { ShellStatusTone } from "./types";

export type TransientToneLine = { readonly text: string; readonly tone: ShellStatusTone };

export type TransientRowInput = {
  readonly alert: TransientToneLine | null;
  readonly notificationToast: string | null;
  /** Immediate arrivals can briefly preempt standing playback alerts. */
  readonly notificationToastPriority?: NotificationPriority | null;
  /** Session-undo line — "added to queue · z undo" or the undo outcome. */
  readonly undoLine?: TransientToneLine | null;
  readonly streakMilestoneAlert: string | null;
  readonly presenceBootLine: TransientToneLine | null;
  readonly streakAtRiskAlert: string | null;
  readonly weeklyDigestLine: string | null;
  /** Once-ever shortcut coaching — yields to everything else on the row. */
  readonly tipLine?: string | null;
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
// genuine alert → notification arrival toast → undo strip → streak milestone →
// presence boot → streak-at-risk → weekly digest → contextual tip. Arrivals
// render bright; calm infos dim. The undo strip outranks the standing
// decorations because it is the only transient that offers a keypress (`z`),
// but it stays below genuine alerts and fresh notification arrivals, which
// carry more urgency. The tip sits last on purpose: a coaching line must
// never displace feedback about something that actually just happened.
// Keeping this pure makes the priority testable without mounting the shell.
export function selectTransientRow(input: TransientRowInput): TransientRowLine | null {
  if (input.notificationToast && input.notificationToastPriority === "immediate") {
    return { text: input.notificationToast, tone: "info", accent: true, dim: false };
  }
  if (input.alert) {
    return { text: input.alert.text, tone: input.alert.tone, accent: false, dim: true };
  }
  if (input.undoLine) {
    return { text: input.undoLine.text, tone: input.undoLine.tone, accent: false, dim: false };
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
  if (input.tipLine) {
    return { text: input.tipLine, tone: "info", accent: false, dim: true };
  }
  return null;
}
