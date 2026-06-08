import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { writeAtomicJson } from "@/infra/fs/atomic-write";

export type TitlePlaybackSourcePreference = {
  readonly providerId: string;
  readonly titleId: string;
  readonly sourceId: string;
  readonly updatedAt: string;
};

type PersistedTitleSourceFile = {
  readonly version: 1;
  readonly preferences: readonly TitlePlaybackSourcePreference[];
};

export class TitlePlaybackSourceService {
  private loaded = false;
  private preferences = new Map<string, TitlePlaybackSourcePreference>();

  constructor(private readonly filePath: string) {}

  async get(input: {
    readonly providerId: string;
    readonly titleId: string;
  }): Promise<TitlePlaybackSourcePreference | null> {
    await this.load();
    return this.preferences.get(preferenceKey(input)) ?? null;
  }

  async set(input: {
    readonly providerId: string;
    readonly titleId: string;
    readonly sourceId: string;
  }): Promise<void> {
    await this.load();
    const key = preferenceKey(input);
    this.preferences.set(key, {
      providerId: input.providerId,
      titleId: input.titleId,
      sourceId: input.sourceId,
      updatedAt: new Date().toISOString(),
    });
    await this.save();
  }

  async delete(input: { readonly providerId: string; readonly titleId: string }): Promise<void> {
    await this.load();
    if (!this.preferences.delete(preferenceKey(input))) return;
    await this.save();
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    try {
      const file = Bun.file(this.filePath);
      if (!(await file.exists())) return;
      const parsed = (await file.json()) as Partial<PersistedTitleSourceFile>;
      if (parsed.version !== 1 || !Array.isArray(parsed.preferences)) return;
      for (const preference of parsed.preferences) {
        if (!isPreference(preference)) continue;
        this.preferences.set(preferenceKey(preference), preference);
      }
    } catch {
      this.preferences.clear();
    }
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const preferences = [...this.preferences.values()].sort((left, right) =>
      preferenceKey(left).localeCompare(preferenceKey(right)),
    );
    await writeAtomicJson(this.filePath, {
      version: 1,
      preferences,
    } satisfies PersistedTitleSourceFile);
  }
}

function preferenceKey(input: { readonly providerId: string; readonly titleId: string }): string {
  return [input.providerId, input.titleId].join(":");
}

function isPreference(value: unknown): value is TitlePlaybackSourcePreference {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.providerId === "string" &&
    typeof candidate.titleId === "string" &&
    typeof candidate.sourceId === "string" &&
    typeof candidate.updatedAt === "string"
  );
}
