import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { writeAtomicJson } from "@/infra/fs/atomic-write";
import {
  decodeProviderEpisodeIdentity,
  encodeProviderEpisodeIdentity,
  type ProviderEpisodeIdentity,
} from "@kunai/types";

export type EpisodePlaybackSelection = {
  readonly providerId: string;
  readonly titleId: string;
  readonly season: number;
  readonly episode: number;
  readonly providerEpisodeIdentityEncoded?: string;
  readonly sourceId?: string;
  readonly streamId?: string;
  readonly updatedAt: string;
};

type PersistedSelectionFile = {
  readonly version: 1;
  readonly selections: readonly EpisodePlaybackSelection[];
};

export class EpisodePlaybackSelectionService {
  private loaded = false;
  private selections = new Map<string, EpisodePlaybackSelection>();

  constructor(private readonly filePath: string) {}

  async get(input: {
    readonly providerId: string;
    readonly titleId: string;
    readonly season: number;
    readonly episode: number;
    readonly providerEpisodeIdentity?: ProviderEpisodeIdentity;
  }): Promise<EpisodePlaybackSelection | null> {
    await this.load();
    return this.selections.get(selectionKey(input)) ?? null;
  }

  async set(input: {
    readonly providerId: string;
    readonly titleId: string;
    readonly season: number;
    readonly episode: number;
    readonly providerEpisodeIdentity?: ProviderEpisodeIdentity;
    readonly sourceId?: string | null;
    readonly streamId?: string | null;
  }): Promise<void> {
    await this.load();
    const key = selectionKey(input);
    this.selections.set(key, {
      providerId: input.providerId,
      titleId: input.titleId,
      season: input.season,
      episode: input.episode,
      providerEpisodeIdentityEncoded: input.providerEpisodeIdentity
        ? encodeProviderEpisodeIdentity(input.providerEpisodeIdentity)
        : undefined,
      ...(input.sourceId ? { sourceId: input.sourceId } : {}),
      ...(input.streamId ? { streamId: input.streamId } : {}),
      updatedAt: new Date().toISOString(),
    });
    await this.save();
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    try {
      const file = Bun.file(this.filePath);
      if (!(await file.exists())) return;
      const parsed = (await file.json()) as Partial<PersistedSelectionFile>;
      if (parsed.version !== 1 || !Array.isArray(parsed.selections)) return;
      for (const selection of parsed.selections) {
        if (!isSelection(selection)) continue;
        this.selections.set(selectionKey(selection), selection);
      }
    } catch {
      this.selections.clear();
    }
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const selections = [...this.selections.values()].sort((left, right) =>
      selectionKey(left).localeCompare(selectionKey(right)),
    );
    await writeAtomicJson(this.filePath, {
      version: 1,
      selections,
    } satisfies PersistedSelectionFile);
  }
}

type EpisodePlaybackSelectionKeyInput = {
  readonly providerId: string;
  readonly titleId: string;
  readonly season: number;
  readonly episode: number;
  readonly providerEpisodeIdentity?: ProviderEpisodeIdentity;
  readonly providerEpisodeIdentityEncoded?: string;
};

function selectionKey(input: EpisodePlaybackSelectionKeyInput): string {
  return [
    input.providerId,
    input.titleId,
    input.season,
    input.episode,
    input.providerEpisodeIdentity
      ? encodeProviderEpisodeIdentity(input.providerEpisodeIdentity)
      : (input.providerEpisodeIdentityEncoded ?? "none"),
  ].join(":");
}

function isSelection(value: unknown): value is EpisodePlaybackSelection {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.providerId === "string" &&
    typeof candidate.titleId === "string" &&
    typeof candidate.season === "number" &&
    typeof candidate.episode === "number" &&
    typeof candidate.updatedAt === "string" &&
    (candidate.providerEpisodeIdentityEncoded === undefined ||
      decodeProviderEpisodeIdentity(String(candidate.providerEpisodeIdentityEncoded)) !==
        undefined) &&
    (candidate.sourceId === undefined || typeof candidate.sourceId === "string") &&
    (candidate.streamId === undefined || typeof candidate.streamId === "string")
  );
}
