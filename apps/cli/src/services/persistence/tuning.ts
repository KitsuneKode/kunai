// =============================================================================
// Runtime tuning namespace
//
// Single source of truth for the runtime durations/budgets that used to live as
// scattered module constants. Each knob has a default and a [min,max] bound.
// Resolution order (last wins): DEFAULT_TUNING -> config-file override -> env.
// Env keys are `KUNAI_TUNING_<SCREAMING_SNAKE(field)>`.
// =============================================================================

export interface TuningConfig {
  // playback / mpv
  readonly mpvReconnectBaseBackoffMs: number;
  readonly mpvReconnectMaxBackoffMs: number;
  readonly mpvSubtitleAttachTimeoutMs: number;
  readonly streamStaleAfterMs: number;
  readonly gracefulExitHandlerTimeoutMs: number;
  // prefetch
  readonly episodePrefetchWaitBudgetMs: number;
  readonly episodePrefetchDefaultWaitBudgetMs: number;
  // network timeouts
  readonly titleDetailFetchTimeoutMs: number;
  readonly discordIpcTimeoutMs: number;
  readonly posterCacheTimeoutMs: number;
  readonly thumbnailTimeoutMs: number;
  // in-session caches
  readonly titleDetailCacheTtlMs: number;
  readonly discoveryCacheTtlMs: number;
  readonly surpriseCacheTtlMs: number;
  readonly nextReleaseTtlMs: number;
  // downloads
  readonly downloadHeartbeatIntervalMs: number;
  readonly downloadStalledHeartbeatMs: number;
  readonly downloadAbortGraceMs: number;
  readonly downloadInactiveWaitMs: number;
  // presence
  readonly presencePausedClearDelayMs: number;
  readonly presenceSessionShowAfterMs: number;
}

interface TuningBound {
  readonly default: number;
  readonly min: number;
  readonly max: number;
}

const MIN = 60_000;
const HOUR = 60 * MIN;

// Defaults mirror the constants they replace; bounds keep user input sane.
const TUNING_SPEC: Readonly<Record<keyof TuningConfig, TuningBound>> = {
  mpvReconnectBaseBackoffMs: { default: 1_800, min: 100, max: 60_000 },
  mpvReconnectMaxBackoffMs: { default: 16_000, min: 1_000, max: 120_000 },
  mpvSubtitleAttachTimeoutMs: { default: 8_000, min: 1_000, max: 60_000 },
  streamStaleAfterMs: { default: 10 * MIN, min: MIN, max: 2 * HOUR },
  gracefulExitHandlerTimeoutMs: { default: 2_000, min: 250, max: 30_000 },
  episodePrefetchWaitBudgetMs: { default: 8_000, min: 500, max: 60_000 },
  episodePrefetchDefaultWaitBudgetMs: { default: 3_000, min: 250, max: 60_000 },
  titleDetailFetchTimeoutMs: { default: 8_000, min: 1_000, max: 60_000 },
  discordIpcTimeoutMs: { default: 10_000, min: 1_000, max: 60_000 },
  posterCacheTimeoutMs: { default: 10_000, min: 1_000, max: 60_000 },
  thumbnailTimeoutMs: { default: 12_000, min: 1_000, max: 60_000 },
  titleDetailCacheTtlMs: { default: 5 * MIN, min: 10_000, max: HOUR },
  discoveryCacheTtlMs: { default: 30 * MIN, min: MIN, max: 24 * HOUR },
  surpriseCacheTtlMs: { default: 10 * MIN, min: MIN, max: 24 * HOUR },
  nextReleaseTtlMs: { default: 2 * HOUR, min: MIN, max: 24 * HOUR },
  downloadHeartbeatIntervalMs: { default: 15_000, min: 1_000, max: 120_000 },
  downloadStalledHeartbeatMs: { default: 90_000, min: 5_000, max: 600_000 },
  downloadAbortGraceMs: { default: 2_500, min: 250, max: 60_000 },
  downloadInactiveWaitMs: { default: 5_000, min: 250, max: 120_000 },
  presencePausedClearDelayMs: { default: 180_000, min: 30_000, max: 600_000 },
  presenceSessionShowAfterMs: { default: 900_000, min: 60_000, max: 4 * HOUR },
};

const TUNING_FIELDS = Object.keys(TUNING_SPEC) as (keyof TuningConfig)[];

export const DEFAULT_TUNING: TuningConfig = Object.freeze(
  Object.fromEntries(TUNING_FIELDS.map((field) => [field, TUNING_SPEC[field].default])) as Record<
    keyof TuningConfig,
    number
  >,
) as TuningConfig;

export function tuningEnvKey(field: keyof TuningConfig): string {
  return `KUNAI_TUNING_${field.replace(/([A-Z])/g, "_$1").toUpperCase()}`;
}

function clamp(value: number, bound: TuningBound): number {
  return Math.max(bound.min, Math.min(bound.max, Math.trunc(value)));
}

function pickNumber(...candidates: (number | undefined)[]): number | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function parseEnvNumber(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function resolveTuning(
  override?: Partial<TuningConfig>,
  env: Record<string, string | undefined> = process.env,
): TuningConfig {
  const resolved = {} as Record<keyof TuningConfig, number>;
  for (const field of TUNING_FIELDS) {
    const bound = TUNING_SPEC[field];
    const chosen = pickNumber(parseEnvNumber(env[tuningEnvKey(field)]), override?.[field]);
    resolved[field] = clamp(chosen ?? bound.default, bound);
  }
  return resolved as TuningConfig;
}
