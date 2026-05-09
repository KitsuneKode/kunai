import { access, constants, stat } from "node:fs/promises";
import { dirname, basename } from "node:path";

import type { Phase, PhaseContext, PhaseResult } from "@/app/Phase";
import type { DownloadJobRecord } from "@kunai/storage";

type OfflineSelection = { type: "job"; id: string } | { type: "back" };
type OfflineItemStatus = "ready" | "missing" | "invalid-file";

export class OfflineLibraryPhase implements Phase<void, "back"> {
  readonly name = "offline-library";

  async execute(_input: void, context: PhaseContext): Promise<PhaseResult<"back">> {
    const { container } = context;
    const jobs = container.downloadService.listCompleted(120);
    if (jobs.length === 0) {
      console.log("No completed downloads found.");
      return { status: "success", value: "back" };
    }

    const jobsWithStatus = await Promise.all(
      jobs.map(async (job) => ({ job, status: await resolveOfflineStatus(job) })),
    );

    const { openListShell } = await import("@/app-shell/ink-shell");
    const options = jobsWithStatus.map(({ job, status }) => ({
      value: { type: "job", id: job.id } as const,
      label: `${statusIcon(status)} ${describeDownloadJob(job)}`,
      detail: describeOfflineDetail(job, status),
    }));

    const picked = await openListShell<OfflineSelection>({
      title: "Offline Library",
      subtitle: `${jobsWithStatus.length} completed downloads`,
      options: [...options, { value: { type: "back" }, label: "Back" }],
    });

    if (!picked || picked.type === "back") {
      return { status: "success", value: "back" };
    }

    const selected = jobs.find((job) => job.id === picked.id);
    if (!selected) {
      return { status: "success", value: "back" };
    }

    const status = await resolveOfflineStatus(selected);
    const action = await openListShell<"play" | "recheck" | "back">({
      title: describeDownloadJob(selected),
      subtitle: describeOfflineDetail(selected, status),
      options: [
        { value: "play", label: "Play now" },
        { value: "recheck", label: "Recheck file" },
        { value: "back", label: "Back" },
      ],
    });

    if (!action || action === "back") {
      return { status: "success", value: "back" };
    }

    if (action === "recheck") {
      return this.execute(undefined, context);
    }

    if (status !== "ready") {
      console.log(`File is ${status}; use /downloads to retry the job.`);
      return { status: "success", value: "back" };
    }

    const timing = parseTiming(selected.introSkipJson);
    await container.player.playLocal({
      filePath: selected.outputPath,
      displayTitle: describeDownloadJob(selected),
      subtitlePath: selected.subtitlePath ?? null,
      timing,
      attach: false,
    });

    return { status: "success", value: "back" };
  }
}

function describeDownloadJob(job: DownloadJobRecord): string {
  const episodeLabel =
    job.season !== undefined && job.episode !== undefined
      ? `S${String(job.season).padStart(2, "0")}E${String(job.episode).padStart(2, "0")}`
      : "movie";
  return `${job.titleName} ${episodeLabel}`;
}

function describeOfflineDetail(job: DownloadJobRecord, status: OfflineItemStatus): string {
  const sizeMb =
    typeof job.fileSize === "number" ? `${(job.fileSize / 1_048_576).toFixed(1)} MB` : null;
  const subtitleLabel = job.subtitlePath ? "subtitles attached" : "no subtitles";
  const parts = [
    `${statusLabel(status)}`,
    sizeMb,
    subtitleLabel,
    basename(dirname(job.outputPath)),
  ].filter(Boolean);
  return parts.join("  ·  ");
}

function statusLabel(status: OfflineItemStatus): string {
  if (status === "ready") return "ready";
  if (status === "missing") return "missing";
  return "invalid-file";
}

function statusIcon(status: OfflineItemStatus): string {
  if (status === "ready") return "✓";
  if (status === "missing") return "!";
  return "×";
}

async function resolveOfflineStatus(job: DownloadJobRecord): Promise<OfflineItemStatus> {
  try {
    await access(job.outputPath, constants.R_OK);
    const fileStat = await stat(job.outputPath);
    if (!fileStat.isFile() || fileStat.size <= 0) return "invalid-file";
    return "ready";
  } catch {
    return "missing";
  }
}

function parseTiming(value?: string): import("@/domain/types").PlaybackTimingMetadata | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as import("@/domain/types").PlaybackTimingMetadata;
  } catch {
    return null;
  }
}
