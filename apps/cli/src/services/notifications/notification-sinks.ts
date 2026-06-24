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

export class OsNotificationSink implements NotificationSink {
  readonly id = "os-stub";

  deliver(_notification: NotificationSinkDelivery): void {
    // Reserved seam for future desktop notifications.
  }

  dismiss(_dedupKey: string): void {
    // no-op stub
  }
}
