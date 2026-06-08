import { runBackgroundTask } from "@/services/diagnostics/background-task";
import type { DiagnosticsService } from "@/services/diagnostics/DiagnosticsService";
import type { ConfigService } from "@/services/persistence/ConfigService";

import {
  buildDiscordActivityUrlFields,
  buildDiscordPosterAsset,
  buildDiscordPresenceButtons,
  buildCatalogViewLink,
} from "./discord-activity-links";
import { createDiscordIpcClient, type DiscordPresenceClient } from "./discord-ipc-client";
import type {
  PresenceBrowseActivity,
  PresenceClientIdSource,
  PresencePlaybackActivity,
  PresenceService,
  PresenceSnapshot,
  PresenceStatus,
} from "./PresenceService";

const DEFAULT_DISCORD_CLIENT_ID = "1502307419047461025";
const DISCORD_ACTIVITY_TEXT_LIMIT = 128;

/** Shown in diagnostics when IPC/update fails and another consumer may hold the Discord app pipe. */
const DISCORD_PRESENCE_MULTI_INSTANCE_DIAGNOSTIC =
  "Another Kunai window or Discord presence app using the same Discord application id may contend for IPC; close other instances or disable Rich Presence there.";

const presenceRuntime = {
  createDiscordClient: (): DiscordPresenceClient => createDiscordIpcClient(),
};

export class PresenceServiceImpl implements PresenceService {
  private status: PresenceStatus = "idle";
  private discordClient: DiscordPresenceClient | null = null;
  private connectPromise: Promise<DiscordPresenceClient | null> | null = null;
  private unavailableUntilRestart = false;
  private unavailableReason: string | null = null;
  private unavailableRetryAtMs = 0;
  private unavailableBackoffMs = 1_000;
  private lastActivityHash: string | null = null;
  private lastActivityPayload: Record<string, unknown> | null = null;
  private lastPlaybackActivity: PresencePlaybackActivity | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private watchSessionStartedAtMs: number | null = null;
  private watchSessionPausedTotalMs = 0;
  private watchSessionPauseStartedAtMs: number | null = null;
  private pausedClearTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly deps: {
      readonly config: ConfigService;
      readonly diagnostics: Pick<DiagnosticsService, "record">;
    },
  ) {
    if (deps.config.presenceProvider === "off") {
      this.status = "disabled";
    }
  }

  getStatus(): PresenceStatus {
    return this.status;
  }

  getSnapshot(): PresenceSnapshot {
    return buildPresenceSnapshot({
      status: this.status,
      provider: this.deps.config.presenceProvider,
      privacy: this.deps.config.presencePrivacy,
      clientIdSource: resolvePresenceClientIdSource(this.deps.config),
      unavailableUntilRestart: this.unavailableUntilRestart,
      unavailableReason: this.unavailableReason,
      unavailableRetryAtMs: this.unavailableRetryAtMs,
    });
  }

  async connect(): Promise<PresenceSnapshot> {
    if (this.deps.config.presenceProvider === "off") {
      this.status = "disabled";
      return this.getSnapshot();
    }
    if (this.deps.config.presenceProvider !== "discord") return this.getSnapshot();

    this.unavailableUntilRestart = false;
    this.unavailableReason = null;
    this.unavailableRetryAtMs = 0;
    this.unavailableBackoffMs = 1_000;
    await this.ensureDiscordClient();
    return this.getSnapshot();
  }

  async disconnect(reason: string): Promise<PresenceSnapshot> {
    await this.clearPlayback(reason);
    const client = this.discordClient;
    this.discordClient = null;
    this.connectPromise = null;
    this.unavailableUntilRestart = false;
    this.unavailableReason = null;
    this.unavailableRetryAtMs = 0;
    this.unavailableBackoffMs = 1_000;
    this.lastActivityHash = null;
    if (client) {
      await client.destroy().catch(() => undefined);
      this.deps.diagnostics.record({
        category: "presence",
        message: "Discord presence disconnected",
        context: { provider: "discord", reason },
      });
    }
    this.status = this.deps.config.presenceProvider === "off" ? "disabled" : "idle";
    return this.getSnapshot();
  }

  async updatePlayback(activity: PresencePlaybackActivity): Promise<void> {
    if (this.deps.config.presenceProvider === "off") {
      this.status = "disabled";
      return;
    }
    if (this.deps.config.presenceProvider !== "discord") return;
    if (this.unavailableUntilRestart) {
      if (Date.now() < this.unavailableRetryAtMs) return;
      this.unavailableUntilRestart = false;
    }

    const client = await this.ensureDiscordClient();
    if (!client) return;

    try {
      this.syncWatchSessionForPlayback(activity);
      this.lastPlaybackActivity = activity;
      const payload = this.buildPlaybackPayload(activity);
      const activityHash = stableJsonHash(payload);
      if (activityHash === this.lastActivityHash) {
        this.status = "ready";
        return;
      }
      await client.setActivity(payload);
      this.status = "ready";
      this.lastActivityHash = activityHash;
      this.lastActivityPayload = payload;
      this.unavailableRetryAtMs = 0;
      this.unavailableBackoffMs = 1_000;
      this.startHeartbeat();
    } catch (error) {
      this.markUnavailable("Discord presence update failed", error, {
        suspectedDuplicateDiscordConsumer: true,
      });
    }
  }

  async updateBrowsing(activity: PresenceBrowseActivity): Promise<void> {
    if (this.deps.config.presenceProvider === "off") {
      this.status = "disabled";
      return;
    }
    if (this.deps.config.presenceProvider !== "discord") return;
    if (this.unavailableUntilRestart) {
      if (Date.now() < this.unavailableRetryAtMs) return;
      this.unavailableUntilRestart = false;
    }

    const client = await this.ensureDiscordClient();
    if (!client) return;

    try {
      const privacy = this.deps.config.presencePrivacy;
      const assets = { large_image: "kunai", large_text: "Kunai" };
      const payload: Record<string, unknown> =
        privacy === "private"
          ? { type: 3, details: "Browsing with Kunai", assets }
          : {
              type: 3,
              details: `Browsing ${activity.view}`,
              ...(activity.detail ? { state: activity.detail } : {}),
              assets,
            };
      const activityHash = stableJsonHash(payload);
      if (activityHash === this.lastActivityHash) return;
      await client.setActivity(payload);
      this.status = "ready";
      this.lastActivityHash = activityHash;
      this.lastActivityPayload = payload;
      this.unavailableRetryAtMs = 0;
      this.unavailableBackoffMs = 1_000;
      this.startHeartbeat();
    } catch (error) {
      this.markUnavailable("Discord browsing presence update failed", error, {
        suspectedDuplicateDiscordConsumer: true,
      });
    }
  }

  async clearPlayback(reason: string): Promise<void> {
    this.stopHeartbeat();
    this.resetWatchSession();
    this.lastPlaybackActivity = null;
    this.lastActivityPayload = null;
    this.lastActivityHash = null;
    if (!this.discordClient) return;
    await this.clearDiscordActivity(this.discordClient, reason);
  }

  private async clearDiscordActivity(client: DiscordPresenceClient, reason: string): Promise<void> {
    try {
      await client.clearActivity();
      this.deps.diagnostics.record({
        category: "presence",
        message: "Presence cleared",
        context: { provider: "discord", reason },
      });
    } catch (error) {
      this.markUnavailable("Discord presence clear failed", error, {
        suspectedDuplicateDiscordConsumer: true,
      });
    }
  }

  async shutdown(): Promise<void> {
    const clearedClient = this.discordClient;
    if (clearedClient) {
      await this.clearPlayback("shutdown");
    } else {
      this.stopHeartbeat();
      this.lastActivityPayload = null;
    }
    this.stopHeartbeat();
    const client = this.discordClient ?? (await this.connectPromise?.catch(() => null));
    if (client && client !== clearedClient) {
      await this.clearDiscordActivity(client, "shutdown");
    }
    this.discordClient = null;
    this.connectPromise = null;
    this.unavailableUntilRestart = false;
    this.unavailableReason = null;
    this.unavailableRetryAtMs = 0;
    this.unavailableBackoffMs = 1_000;
    this.lastActivityHash = null;
    this.lastActivityPayload = null;
    if (!client) return;
    await client.destroy().catch(() => undefined);
    this.status = this.deps.config.presenceProvider === "off" ? "disabled" : "idle";
  }

  private async ensureDiscordClient(): Promise<DiscordPresenceClient | null> {
    if (this.discordClient) return this.discordClient;
    if (this.connectPromise) return this.connectPromise;

    const clientId = resolvePresenceClientId(this.deps.config);
    if (!clientId) {
      this.markUnavailable("Discord presence needs a client id", "missing-client-id");
      return null;
    }

    this.status = "connecting";
    this.connectPromise = this.createDiscordClient(clientId).finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  private async createDiscordClient(clientId: string): Promise<DiscordPresenceClient | null> {
    try {
      const client = presenceRuntime.createDiscordClient();
      await client.login({ clientId });
      this.discordClient = client;
      this.status = "ready";
      this.unavailableReason = null;
      this.unavailableRetryAtMs = 0;
      this.unavailableBackoffMs = 1_000;
      this.deps.diagnostics.record({
        category: "presence",
        message: "Discord presence connected",
        context: { provider: "discord", transport: "bun-discord-ipc" },
      });
      return client;
    } catch (error) {
      this.markUnavailable("Discord presence unavailable", error, {
        suspectedDuplicateDiscordConsumer: true,
      });
      return null;
    }
  }

  private markUnavailable(
    message: string,
    error: unknown,
    options?: { suspectedDuplicateDiscordConsumer?: boolean },
  ): void {
    this.status = "unavailable";
    this.unavailableUntilRestart = true;
    this.unavailableReason = normalizePresenceError(error);
    this.unavailableRetryAtMs = Date.now() + this.unavailableBackoffMs;
    this.unavailableBackoffMs = Math.min(this.unavailableBackoffMs * 2, 60_000);
    this.deps.diagnostics.record({
      category: "presence",
      message,
      context: {
        provider: "discord",
        error: this.unavailableReason ?? String(error),
        retry: `auto-retry-in-${Math.max(1, Math.ceil((this.unavailableRetryAtMs - Date.now()) / 1000))}s`,
        ...(options?.suspectedDuplicateDiscordConsumer
          ? { suspectedDuplicateDiscordConsumer: DISCORD_PRESENCE_MULTI_INSTANCE_DIAGNOSTIC }
          : {}),
      },
    });
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      runBackgroundTask({
        task: "presence.heartbeat",
        category: "presence",
        diagnostics: this.deps.diagnostics,
        run: () => this.sendHeartbeat(),
      });
    }, 15_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async sendHeartbeat(): Promise<void> {
    if (!this.discordClient) {
      if (this.unavailableUntilRestart && Date.now() >= this.unavailableRetryAtMs) {
        this.unavailableUntilRestart = false;
        runBackgroundTask({
          task: "presence.reconnectFromHeartbeat",
          category: "presence",
          diagnostics: this.deps.diagnostics,
          run: () => this.tryReconnect(),
        });
      }
      return;
    }
    if (!this.lastPlaybackActivity) return;
    try {
      const payload = this.buildPlaybackPayload(this.lastPlaybackActivity);
      await this.discordClient.setActivity(payload);
      this.lastActivityPayload = payload;
      this.lastActivityHash = stableJsonHash(payload);
    } catch {
      this.markUnavailable("Discord connection lost", new Error("heartbeat failure"));
    }
  }

  private buildPlaybackPayload(activity: PresencePlaybackActivity): Record<string, unknown> {
    return buildDiscordActivity(activity, this.deps.config.presencePrivacy, {
      sessionElapsedMs: this.computeWatchSessionElapsedMs(activity.paused === true),
      sessionShowAfterMs: this.deps.config.tuning.presenceSessionShowAfterMs,
    });
  }

  private syncWatchSessionForPlayback(activity: PresencePlaybackActivity): void {
    if (!this.watchSessionStartedAtMs) {
      this.watchSessionStartedAtMs = Date.now();
    }

    const isPaused = activity.paused === true;
    if (isPaused && this.watchSessionPauseStartedAtMs === null) {
      this.watchSessionPauseStartedAtMs = Date.now();
      this.schedulePausedClear();
      return;
    }

    if (!isPaused && this.watchSessionPauseStartedAtMs !== null) {
      this.watchSessionPausedTotalMs += Date.now() - this.watchSessionPauseStartedAtMs;
      this.watchSessionPauseStartedAtMs = null;
      this.cancelPausedClear();
    }
  }

  private computeWatchSessionElapsedMs(isPaused: boolean): number {
    if (!this.watchSessionStartedAtMs) return 0;
    const now = Date.now();
    const activePauseMs =
      isPaused && this.watchSessionPauseStartedAtMs !== null
        ? now - this.watchSessionPauseStartedAtMs
        : 0;
    return Math.max(
      0,
      now - this.watchSessionStartedAtMs - this.watchSessionPausedTotalMs - activePauseMs,
    );
  }

  private resetWatchSession(): void {
    this.watchSessionStartedAtMs = null;
    this.watchSessionPausedTotalMs = 0;
    this.watchSessionPauseStartedAtMs = null;
    this.cancelPausedClear();
  }

  private schedulePausedClear(): void {
    this.cancelPausedClear();
    const delayMs = this.deps.config.tuning.presencePausedClearDelayMs;
    this.pausedClearTimer = setTimeout(() => {
      this.pausedClearTimer = null;
      void this.clearPlayback("paused-timeout");
    }, delayMs);
  }

  private cancelPausedClear(): void {
    if (!this.pausedClearTimer) return;
    clearTimeout(this.pausedClearTimer);
    this.pausedClearTimer = null;
  }

  private async tryReconnect(): Promise<void> {
    this.stopHeartbeat();
    if (this.discordClient) {
      try {
        await this.discordClient.destroy();
      } catch {
        // ignore destroy errors
      }
      this.discordClient = null;
    }
    this.connectPromise = null;
    this.unavailableUntilRestart = false;
    const client = await this.ensureDiscordClient();
    if (!client || !this.lastActivityPayload) return;
    try {
      await client.setActivity(this.lastActivityPayload);
      this.startHeartbeat();
    } catch {
      this.markUnavailable("Discord reconnect failed", new Error("reconnect failure"));
    }
  }
}

function normalizePresenceError(error: unknown): string {
  const raw = String(error).trim();
  if (raw.startsWith("Error: ")) return raw.slice("Error: ".length);
  return raw;
}

function stableJsonHash(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

export type DiscordActivityBuildContext = {
  readonly sessionElapsedMs?: number;
  readonly sessionShowAfterMs?: number;
};

/** Builds a Discord local IPC activity object (snake_case timestamps/assets, not discord-rpc npm shape). */
export function buildDiscordActivity(
  activity: PresencePlaybackActivity,
  privacy: "full" | "private",
  context: DiscordActivityBuildContext = {},
): Record<string, unknown> {
  if (privacy === "private") {
    return {
      type: 3,
      details: "Watching with Kunai",
      state: activity.paused ? "Paused" : "Playing",
      assets: { large_image: "kunai", large_text: "Kunai" },
      ...(activity.paused ? { timestamps: null } : {}),
    };
  }

  const timeline = buildDiscordPlaybackTimeline(activity);
  const progressLabel = formatPlaybackProgressLabel(
    activity.positionSeconds,
    activity.durationSeconds,
  );
  const posterAsset = buildDiscordPosterAsset(activity.title, activity.episode);
  const viewLink = buildCatalogViewLink({ mode: activity.mode, title: activity.title });
  const assets = {
    ...posterAsset,
    ...(viewLink ? { large_url: viewLink.url } : {}),
  };
  const buttons = buildDiscordPresenceButtons(activity, privacy);
  const urlFields = buildDiscordActivityUrlFields(activity);
  const stateLine = appendWatchSessionSuffix(
    buildDiscordPlaybackStateLine(activity, progressLabel),
    activity.paused === true,
    context,
  );

  const hasPlaybackTimeline = "timestamps" in timeline;

  return {
    type: 3,
    details: limitDiscordText(activity.title.name),
    state: limitDiscordText(stateLine),
    ...urlFields,
    ...(hasPlaybackTimeline ? timeline : activity.paused ? { timestamps: null } : timeline),
    assets,
    ...(buttons.length > 0 ? { buttons } : {}),
  };
}

function buildDiscordPlaybackStateLine(
  activity: PresencePlaybackActivity,
  progressLabel: string | null,
): string {
  if (activity.title.type === "movie") {
    if (activity.paused) {
      return progressLabel ? `Paused at ${progressLabel}` : "Paused";
    }
    return activity.title.year ?? "Movie";
  }

  const episodeName = activity.episode.name?.trim();
  const numbered = `S${activity.episode.season} E${activity.episode.episode}`;
  const episodeLabel = episodeName ? `${numbered} · ${episodeName}` : numbered;
  if (activity.paused) {
    if (hasDiscordPlaybackTimeline(activity)) return episodeLabel;
    return compact([episodeLabel, progressLabel ? `Paused at ${progressLabel}` : "Paused"]).join(
      " · ",
    );
  }

  return episodeLabel;
}

function hasDiscordPlaybackTimeline(
  activity: Pick<PresencePlaybackActivity, "positionSeconds" | "durationSeconds">,
): boolean {
  const positionSeconds = normalizePresenceSeconds(activity.positionSeconds);
  const durationSeconds = normalizePresenceSeconds(activity.durationSeconds);
  return durationSeconds > 0 && durationSeconds > positionSeconds;
}

export const __testing = {
  runtime: presenceRuntime,
};

function appendWatchSessionSuffix(
  state: string,
  paused: boolean,
  context: DiscordActivityBuildContext,
): string {
  if (paused) return state;
  const elapsedMs = context.sessionElapsedMs ?? 0;
  const thresholdMs = context.sessionShowAfterMs ?? 900_000;
  if (elapsedMs < thresholdMs) return state;
  return `${state} · ${formatSessionDuration(elapsedMs)} with Kunai`;
}

function formatSessionDuration(elapsedMs: number): string {
  const totalMinutes = Math.floor(elapsedMs / 60_000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function buildDiscordPlaybackTimeline(
  activity: Pick<PresencePlaybackActivity, "startedAtMs" | "positionSeconds" | "durationSeconds">,
): { timestamps?: { start: number; end: number } } {
  const positionSeconds = normalizePresenceSeconds(activity.positionSeconds);
  const durationSeconds = normalizePresenceSeconds(activity.durationSeconds);
  // Only emit a timeline when we have a real end → Discord renders a progress
  // BAR (Cider-style "00:31 ── 03:55"). Emitting only `start` (no duration yet)
  // makes Discord show a growing "elapsed" counter that reads as idle time, so
  // we omit the timeline entirely until a duration is known.
  if (durationSeconds <= 0 || durationSeconds <= positionSeconds) {
    return {};
  }
  const startedAtMs = Date.now() - positionSeconds * 1_000;
  return {
    timestamps: {
      start: Math.floor(startedAtMs / 1_000),
      end: Math.floor((startedAtMs + durationSeconds * 1_000) / 1_000),
    },
  };
}

function formatPlaybackProgressLabel(
  positionSeconds: number | undefined,
  durationSeconds: number | undefined,
): string | null {
  const position = normalizePresenceSeconds(positionSeconds);
  if (position <= 0) return null;
  const duration = normalizePresenceSeconds(durationSeconds);
  if (duration > position) return `${formatMediaTime(position)} / ${formatMediaTime(duration)}`;
  return formatMediaTime(position);
}

function normalizePresenceSeconds(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function formatMediaTime(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function compact(values: readonly (string | undefined | null | false)[]): string[] {
  return values.filter((value): value is string => typeof value === "string" && value.length > 0);
}

function limitDiscordText(value: string): string {
  if (value.length <= DISCORD_ACTIVITY_TEXT_LIMIT) return value;
  if (DISCORD_ACTIVITY_TEXT_LIMIT <= 1) return value.slice(0, DISCORD_ACTIVITY_TEXT_LIMIT);
  return `${value.slice(0, DISCORD_ACTIVITY_TEXT_LIMIT - 3)}...`;
}

export function describePresenceConfiguration(
  config: Pick<ConfigService, "presenceProvider" | "presencePrivacy" | "presenceDiscordClientId">,
  env?: { readonly KUNAI_DISCORD_CLIENT_ID?: string },
): string {
  if (config.presenceProvider === "off") return "off";
  const source = resolvePresenceClientIdSource(config, env);
  const clientIdSource =
    source === "config"
      ? "config client id"
      : source === "environment"
        ? "env client id"
        : source === "default"
          ? "default client id"
          : "missing client id";
  return `${config.presenceProvider}  ·  privacy ${config.presencePrivacy}  ·  ${clientIdSource}`;
}

export function resolvePresenceClientId(
  config: Pick<ConfigService, "presenceDiscordClientId">,
  env?: { readonly KUNAI_DISCORD_CLIENT_ID?: string },
): string {
  return (
    config.presenceDiscordClientId.trim() ||
    env?.KUNAI_DISCORD_CLIENT_ID?.trim() ||
    process.env.KUNAI_DISCORD_CLIENT_ID?.trim() ||
    DEFAULT_DISCORD_CLIENT_ID
  );
}

export function resolvePresenceClientIdSource(
  config: Pick<ConfigService, "presenceProvider" | "presenceDiscordClientId">,
  env?: { readonly KUNAI_DISCORD_CLIENT_ID?: string },
): PresenceClientIdSource {
  if (config.presenceProvider === "off") return "off";
  if (config.presenceDiscordClientId.trim()) return "config";
  if ((env?.KUNAI_DISCORD_CLIENT_ID ?? process.env.KUNAI_DISCORD_CLIENT_ID)?.trim()) {
    return "environment";
  }
  return DEFAULT_DISCORD_CLIENT_ID ? "default" : "missing";
}

export function buildPresenceSnapshot({
  status,
  provider,
  privacy,
  clientIdSource,
  unavailableUntilRestart,
  unavailableReason,
  unavailableRetryAtMs,
}: {
  readonly status: PresenceStatus;
  readonly provider: "off" | "discord";
  readonly privacy: "full" | "private";
  readonly clientIdSource: PresenceClientIdSource;
  readonly unavailableUntilRestart: boolean;
  readonly unavailableReason?: string | null;
  readonly unavailableRetryAtMs?: number;
}): PresenceSnapshot {
  if (provider === "off") {
    return {
      provider,
      status: "disabled",
      privacy,
      clientIdSource: "off",
      canConnect: false,
      detail: "off",
    };
  }

  if (clientIdSource === "missing") {
    return {
      provider,
      status,
      privacy,
      clientIdSource,
      canConnect: false,
      detail: "missing Discord application client id",
    };
  }

  if (unavailableUntilRestart) {
    const retrySeconds =
      unavailableRetryAtMs && unavailableRetryAtMs > Date.now()
        ? Math.max(1, Math.ceil((unavailableRetryAtMs - Date.now()) / 1000))
        : null;
    return {
      provider,
      status: "unavailable",
      privacy,
      clientIdSource,
      canConnect: false,
      detail: unavailableReason
        ? `unavailable  ·  ${unavailableReason}${retrySeconds ? `  ·  retrying in ${retrySeconds}s` : ""}`
        : retrySeconds
          ? `unavailable  ·  retrying in ${retrySeconds}s`
          : "unavailable",
    };
  }

  return {
    provider,
    status,
    privacy,
    clientIdSource,
    canConnect: true,
    detail:
      status === "ready"
        ? "connected to local Discord client"
        : status === "connecting"
          ? "connecting to local Discord client"
          : "ready to connect",
  };
}
