import type { DiagnosticsStore } from "@/services/diagnostics/DiagnosticsStore";
import type { ConfigService } from "@/services/persistence/ConfigService";

import type { PresencePlaybackActivity, PresenceService, PresenceStatus } from "./PresenceService";

type DiscordRpcClient = {
  login(input: { clientId: string }): Promise<void>;
  setActivity(activity: Record<string, unknown>): Promise<void>;
  clearActivity(): Promise<void>;
  destroy(): Promise<void>;
  on(event: "ready", callback: () => void): void;
};

export class PresenceServiceImpl implements PresenceService {
  private status: PresenceStatus = "idle";
  private discordClient: DiscordRpcClient | null = null;
  private connectPromise: Promise<DiscordRpcClient | null> | null = null;
  private unavailableUntilRestart = false;

  constructor(
    private readonly deps: {
      readonly config: ConfigService;
      readonly diagnosticsStore: DiagnosticsStore;
    },
  ) {
    if (deps.config.presenceProvider === "off") {
      this.status = "disabled";
    }
  }

  getStatus(): PresenceStatus {
    return this.status;
  }

  async updatePlayback(activity: PresencePlaybackActivity): Promise<void> {
    if (this.deps.config.presenceProvider === "off") {
      this.status = "disabled";
      return;
    }
    if (this.deps.config.presenceProvider !== "discord") return;
    if (this.unavailableUntilRestart) return;

    const client = await this.ensureDiscordClient();
    if (!client) return;

    try {
      await client.setActivity(buildDiscordActivity(activity, this.deps.config.presencePrivacy));
      this.status = "ready";
    } catch (error) {
      this.markUnavailable("Discord presence update failed", error);
    }
  }

  async clearPlayback(reason: string): Promise<void> {
    if (!this.discordClient) return;
    try {
      await this.discordClient.clearActivity();
      this.deps.diagnosticsStore.record({
        category: "presence",
        message: "Presence cleared",
        context: { provider: "discord", reason },
      });
    } catch (error) {
      this.markUnavailable("Discord presence clear failed", error);
    }
  }

  async shutdown(): Promise<void> {
    const client = this.discordClient;
    this.discordClient = null;
    this.connectPromise = null;
    if (!client) return;
    await client.destroy().catch(() => undefined);
    this.status = this.deps.config.presenceProvider === "off" ? "disabled" : "idle";
  }

  private async ensureDiscordClient(): Promise<DiscordRpcClient | null> {
    if (this.discordClient) return this.discordClient;
    if (this.connectPromise) return this.connectPromise;

    const clientId =
      this.deps.config.presenceDiscordClientId || process.env.KUNAI_DISCORD_CLIENT_ID || "";
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

  private async createDiscordClient(clientId: string): Promise<DiscordRpcClient | null> {
    try {
      const packageName = "discord-rpc";
      const mod = (await import(packageName)) as {
        default?: { Client: new (opts: { transport: "ipc" }) => DiscordRpcClient };
        Client?: new (opts: { transport: "ipc" }) => DiscordRpcClient;
      };
      const Client = mod.Client ?? mod.default?.Client;
      if (!Client) {
        this.markUnavailable("Discord RPC package did not expose a client", "missing-client");
        return null;
      }
      const client = new Client({ transport: "ipc" });
      await client.login({ clientId });
      this.discordClient = client;
      this.status = "ready";
      this.deps.diagnosticsStore.record({
        category: "presence",
        message: "Discord presence connected",
        context: { provider: "discord" },
      });
      return client;
    } catch (error) {
      this.markUnavailable("Discord presence unavailable", error);
      return null;
    }
  }

  private markUnavailable(message: string, error: unknown): void {
    this.status = "unavailable";
    this.unavailableUntilRestart = true;
    this.deps.diagnosticsStore.record({
      category: "presence",
      message,
      context: {
        provider: "discord",
        error: String(error),
        retry: "disabled-until-restart",
      },
    });
  }
}

export function buildDiscordActivity(
  activity: PresencePlaybackActivity,
  privacy: "full" | "private",
): Record<string, unknown> {
  const episodeLabel =
    activity.title.type === "series"
      ? `S${String(activity.episode.season).padStart(2, "0")}E${String(
          activity.episode.episode,
        ).padStart(2, "0")}`
      : "Movie";

  if (privacy === "private") {
    return {
      details: "Watching with Kunai",
      state: "Playback active",
      startTimestamp: Math.floor(activity.startedAtMs / 1000),
      largeImageKey: "kunai",
      largeImageText: "Kunai",
    };
  }

  return {
    details:
      activity.title.type === "series"
        ? `${activity.title.name} ${episodeLabel}`
        : activity.title.name,
    state: `${activity.mode} · ${activity.providerId}`,
    startTimestamp: Math.floor(activity.startedAtMs / 1000),
    largeImageKey: "kunai",
    largeImageText: "Kunai",
    smallImageKey: activity.stream?.subtitle ? "subtitles" : undefined,
    smallImageText: activity.stream?.subtitle ? "Subtitles attached" : undefined,
  };
}
