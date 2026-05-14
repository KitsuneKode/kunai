import type {
  CatalogScheduleInput,
  CatalogScheduleItem,
  CatalogScheduleMode,
  CatalogScheduleService,
} from "./CatalogScheduleService";

export type TimelineBadgeTone = "success" | "info" | "warning" | "neutral";

export type TimelineBadge = {
  readonly label: string;
  readonly tone: TimelineBadgeTone;
  readonly releaseAt: string | null;
  readonly status: CatalogScheduleItem["status"];
};

export class TimelineService {
  constructor(
    private readonly schedule: Pick<
      CatalogScheduleService,
      "getNextRelease" | "loadReleasingToday"
    >,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async getNextReleaseBadge(
    input: CatalogScheduleInput,
    signal?: AbortSignal,
  ): Promise<TimelineBadge | null> {
    const item = await this.schedule.getNextRelease(input, signal);
    return item ? buildTimelineBadge(item, this.now()) : null;
  }

  async loadReleasingToday(
    mode: CatalogScheduleMode,
    signal?: AbortSignal,
  ): Promise<readonly CatalogScheduleItem[]> {
    return this.schedule.loadReleasingToday(mode, signal);
  }
}

export function buildTimelineBadge(item: CatalogScheduleItem, nowMs: number): TimelineBadge {
  if (item.status === "unknown") {
    return {
      label: "release unknown",
      tone: "neutral",
      releaseAt: item.releaseAt,
      status: item.status,
    };
  }

  if (!item.releaseAt) {
    return {
      label: "release unknown",
      tone: "neutral",
      releaseAt: item.releaseAt,
      status: item.status,
    };
  }

  if (isSameLocalDay(item.releaseAt, nowMs)) {
    return {
      label: item.status === "released" ? "new today" : "airs today",
      tone: item.status === "released" ? "success" : "info",
      releaseAt: item.releaseAt,
      status: item.status,
    };
  }

  if (item.status === "upcoming") {
    return {
      label: `next ${formatShortDate(item.releaseAt)}`,
      tone: "info",
      releaseAt: item.releaseAt,
      status: item.status,
    };
  }

  return {
    label: "released",
    tone: "success",
    releaseAt: item.releaseAt,
    status: item.status,
  };
}

function isSameLocalDay(releaseAt: string, nowMs: number): boolean {
  const release = new Date(releaseAt);
  const now = new Date(nowMs);
  return (
    release.getFullYear() === now.getFullYear() &&
    release.getMonth() === now.getMonth() &&
    release.getDate() === now.getDate()
  );
}

function formatShortDate(releaseAt: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(releaseAt));
}
