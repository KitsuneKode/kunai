import {
  isNotificationKind,
  type NotificationKind,
} from "@/domain/notifications/notification-kinds";
import type { NotificationRecord } from "@kunai/storage";

export type { NotificationKind };

export type NotificationSinkDelivery = {
  readonly dedupKey: string;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly body?: string;
  readonly createdAt: string;
};

export interface NotificationSink {
  readonly id: string;
  deliver(notification: NotificationSinkDelivery): void;
  dismiss(dedupKey: string): void;
}

export class NotificationSinkRegistry {
  private readonly sinks = new Map<string, NotificationSink>();

  register(sink: NotificationSink): () => void {
    this.sinks.set(sink.id, sink);
    return () => {
      this.sinks.delete(sink.id);
    };
  }

  deliver(notification: NotificationSinkDelivery): void {
    for (const sink of this.sinks.values()) sink.deliver(notification);
  }

  dismiss(dedupKey: string): void {
    for (const sink of this.sinks.values()) sink.dismiss(dedupKey);
  }
}

export function mapRecordToSinkDelivery(
  record: NotificationRecord,
): NotificationSinkDelivery | null {
  if (!isNotificationKind(record.kind)) return null;
  return {
    dedupKey: record.dedupKey,
    kind: record.kind,
    title: record.title,
    body: record.body ?? undefined,
    createdAt: record.createdAt,
  };
}
