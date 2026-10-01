import { whichLive } from "@/infra/os/which";

import type { NotificationSink, NotificationSinkDelivery } from "./notification-sink";

export class LogNotificationSink implements NotificationSink {
  readonly id = "log";

  constructor(private readonly log: (message: string, context?: Record<string, unknown>) => void) {}

  deliver(notification: NotificationSinkDelivery): void {
    this.log("notification.delivered", {
      dedupKey: notification.dedupKey,
      kind: notification.kind,
      title: notification.title,
    });
  }

  dismiss(dedupKey: string): void {
    this.log("notification.dismissed", { dedupKey });
  }
}

/**
 * The pieces of process/platform the OS sink needs, injected so tests exercise
 * every branch without touching a real desktop. Same shape as
 * `infra/os/external-open.ts`'s runtime port, deliberately.
 */
export type OsNotificationRuntime = {
  readonly platform: NodeJS.Platform;
  readonly which: (command: string) => string | null;
  readonly spawn: (
    command: string[],
    options?: Parameters<typeof Bun.spawn>[1],
  ) => { readonly exited: Promise<number>; kill?(): void };
};

const DESKTOP_NOTIFICATIONS_ENV = "KUNAI_DESKTOP_NOTIFICATIONS";

/**
 * Opt-out kill switch for OS notification delivery. Default is on — this is
 * the same posture as `attentionInbox`, where the flag exists so a bad rollout
 * or a bare-server environment can be silenced without a rebuild.
 */
export function areDesktopNotificationsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env[DESKTOP_NOTIFICATIONS_ENV];
  if (flag === undefined) return true;
  return !["0", "false", "no", "off"].includes(flag.trim().toLowerCase());
}

/**
 * PowerShell toast script for Windows. Title/body arrive over `env:` so the
 * command line carries no user data — a `"` or `;` in a title is a text node
 * value, never script source. The AUMID is the well-known Windows PowerShell
 * app id, which registers a toast-capable identity without shipping a helper
 * binary or installing BurntToast.
 */
const WINDOWS_TOAST_SCRIPT = [
  "$ErrorActionPreference='SilentlyContinue'",
  "[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]|Out-Null",
  "$t=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)",
  "$n=$t.GetElementsByTagName('text')",
  "$n.Item(0).AppendChild($t.CreateTextNode($env:KUNAI_NOTIFY_TITLE))|Out-Null",
  "$n.Item(1).AppendChild($t.CreateTextNode($env:KUNAI_NOTIFY_BODY))|Out-Null",
  "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($t))",
].join(";");

function encodePowerShellScript(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

type OsNotifyCommand =
  | {
      readonly command: readonly string[];
      readonly env?: Record<string, string>;
    }
  | { readonly unavailable: true };

function resolveOsNotifyCommand(
  notification: NotificationSinkDelivery,
  runtime: OsNotificationRuntime,
): OsNotifyCommand {
  const title = notification.title;
  const body = notification.body ?? "";

  if (runtime.platform === "linux") {
    const bin = runtime.which("notify-send");
    if (!bin) return { unavailable: true };
    // argv only, no shell: `-a` brands the notification, the title/body are
    // positional and cannot inject options because they come last.
    const args = [bin, "-a", "Kunai", title];
    if (body) args.push(body);
    return { command: args };
  }

  if (runtime.platform === "darwin") {
    const bin = runtime.which("osascript");
    if (!bin) return { unavailable: true };
    // `on run argv` keeps the title/body as data — the alternative (string
    // interpolation into -e source) is an injection hole for quotes.
    return {
      command: [
        bin,
        "-e",
        "on run argv",
        "-e",
        "display notification (item 1 of argv) with title (item 2 of argv)",
        "-e",
        "end run",
        "--",
        body,
        title,
      ],
    };
  }

  if (runtime.platform === "win32") {
    const bin = runtime.which("powershell.exe") ?? runtime.which("powershell");
    if (!bin) return { unavailable: true };
    return {
      command: [
        bin,
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-EncodedCommand",
        encodePowerShellScript(WINDOWS_TOAST_SCRIPT),
      ],
      env: { KUNAI_NOTIFY_TITLE: title, KUNAI_NOTIFY_BODY: body },
    };
  }

  return { unavailable: true };
}

/** How long a notifier subprocess may run before it is reaped. */
const NOTIFY_TIMEOUT_MS = 5_000;
/** Cap on remembered dedup keys so a long session's set cannot grow forever. */
const SEEN_KEYS_LIMIT = 500;

/**
 * Best-effort desktop notifications: `notify-send` on Linux, `osascript` on
 * macOS, a WinRT toast via PowerShell on Windows.
 *
 * Design constraints:
 *
 * - `NotificationService.emitChange()` calls `deliverActive` with the *entire
 *   active set* on every mutation, so this sink keeps its own `dedupKey` set
 *   and only pops a notification once per key until `dismiss` or eviction.
 *   The set is per-process, so `createdAt` is used as a floor too: anything
 *   recorded before this sink existed stays silent instead of replaying the
 *   whole inbox on every launch.
 * - Fire-and-forget but bounded: the child gets ignored stdio, a reaper timer,
 *   and every failure path is swallowed — a missing notifier binary or a
 *   locked notification daemon must never take the CLI down or block a frame.
 * - The payload is `title`/`body` only. `NotificationRecord` never carries
 *   stream URLs, headers, cookies, or tokens; this sink passes through exactly
 *   what the record stores and nothing else.
 */
export class OsNotificationSink implements NotificationSink {
  readonly id = "os";

  private readonly seen = new Set<string>();
  /** Records older than this were written by a previous session — no popup. */
  private readonly createdFloorMs: number;

  constructor(
    private readonly runtime: OsNotificationRuntime = {
      platform: process.platform,
      which: (command) => whichLive(command),
      spawn: (command, options) => Bun.spawn(command, options),
    },
    private readonly isEnabled: () => boolean = () => areDesktopNotificationsEnabled(),
    nowMs: () => number = () => Date.now(),
  ) {
    // Small negative skew: a record written microseconds before construction
    // is still this session's notification.
    this.createdFloorMs = nowMs() - 1_000;
  }

  deliver(notification: NotificationSinkDelivery): void {
    if (this.seen.has(notification.dedupKey)) return;
    if (!this.isEnabled()) return;
    const createdMs = Date.parse(notification.createdAt);
    if (Number.isFinite(createdMs) && createdMs < this.createdFloorMs) return;

    const resolved = resolveOsNotifyCommand(notification, this.runtime);
    if ("unavailable" in resolved) return;

    this.remember(notification.dedupKey);

    try {
      const proc = this.runtime.spawn([...resolved.command], {
        stdout: "ignore",
        stderr: "ignore",
        stdin: "ignore",
        env: resolved.env ? { ...process.env, ...resolved.env } : undefined,
      });
      const reaper = setTimeout(() => {
        try {
          proc.kill?.();
        } catch {
          // already exited — fine
        }
      }, NOTIFY_TIMEOUT_MS);
      reaper.unref();
      // One settled handler: clears the reaper and swallows a rejected
      // `exited` so a hung notifier can never surface as an unhandled
      // rejection in the shell loop.
      void proc.exited.then(
        () => void clearTimeout(reaper),
        () => void clearTimeout(reaper),
      );
    } catch {
      // spawn itself threw (ENOENT races with which()): swallow — the inbox is
      // the durable surface, the popup was decoration.
    }
  }

  dismiss(dedupKey: string): void {
    // Re-arm the key so a notification recreated after an explicit archive can
    // pop again. OS-level dismissal is not portable (notify-send has no stable
    // id contract); the notification center owns that UX.
    this.seen.delete(dedupKey);
  }

  private remember(dedupKey: string): void {
    this.seen.add(dedupKey);
    if (this.seen.size <= SEEN_KEYS_LIMIT) return;
    // Map/Set iterate in insertion order — evict the oldest half.
    let toDrop = this.seen.size - SEEN_KEYS_LIMIT / 2;
    for (const key of this.seen) {
      if (toDrop-- <= 0) break;
      this.seen.delete(key);
    }
  }
}
