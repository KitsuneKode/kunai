import type { NotificationSignal } from "@/services/notifications/NotificationEngine";

export interface ReleaseAvailabilityInput {
  readonly titleId: string;
  readonly mediaKind: string;
  readonly title: string;
  readonly season?: number;
  readonly episode?: number;
  readonly released: boolean;
  readonly providerConfirmed: boolean;
  readonly providerId?: string;
  readonly availableAt?: string;
  readonly streamUrl?: string;
}

export interface ReleaseAvailabilityProjection {
  readonly shelfState: "unreleased" | "released-unconfirmed" | "provider-confirmed";
  readonly notificationSignal?: NotificationSignal;
}

export function projectReleaseAvailability(
  input: ReleaseAvailabilityInput,
): ReleaseAvailabilityProjection {
  if (!input.released) return { shelfState: "unreleased" };
  if (!input.providerConfirmed || !input.providerId) return { shelfState: "released-unconfirmed" };
  return {
    shelfState: "provider-confirmed",
    notificationSignal: {
      type: "new-playable-episode",
      titleId: input.titleId,
      mediaKind: input.mediaKind,
      title: input.title,
      season: input.season,
      episode: input.episode,
      providerId: input.providerId,
      availableAt: input.availableAt ?? new Date().toISOString(),
    },
  };
}
