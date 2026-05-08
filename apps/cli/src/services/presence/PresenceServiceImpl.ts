import type { DiagnosticsStore } from "@/services/diagnostics/DiagnosticsStore";
import type { ConfigService } from "@/services/persistence/ConfigService";

import type {
  PresenceClientIdSource,
  PresencePlaybackActivity,
  PresenceService,
  PresenceSnapshot,
  PresenceStatus,
} from "./PresenceService";

type DiscordRpcClient = {
  login(input: { clientId: string }): Promise<void>;
  setActivity(activity: Record<string, unknown>): Promise<void>;
  clearActivity(): Promise<void>;
  destroy(): Promise<void>;
  on(event: "ready", callback: () => void): void;
};

const DEFAULT_DISCORD_CLIENT_ID = "1502307419047461025";

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

  getSnapshot(): PresenceSnapshot {
    return buildPresenceSnapshot({
      status: this.status,
      provider: this.deps.config.presenceProvider,
      privacy: this.deps.config.presencePrivacy,
      clientIdSource: resolvePresenceClientIdSource(this.deps.config),
      unavailableUntilRestart: this.unavailableUntilRestart,
    });
  }

  async connect(): Promise<PresenceSnapshot> {
    if (this.deps.config.presenceProvider === "off") {
      this.status = "disabled";
      return this.getSnapshot();
    }
    if (this.deps.config.presenceProvider !== "discord") return this.getSnapshot();

    this.unavailableUntilRestart = false;
    await this.ensureDiscordClient();
    return this.getSnapshot();
  }

  async disconnect(reason: string): Promise<PresenceSnapshot> {
    await this.clearPlayback(reason);
    const client = this.discordClient;
    this.discordClient = null;
    this.connectPromise = null;
    this.unavailableUntilRestart = false;
    if (client) {
      await client.destroy().catch(() => undefined);
      this.deps.diagnosticsStore.record({
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
    this.unavailableUntilRestart = false;
    if (!client) return;
    await client.destroy().catch(() => undefined);
    this.status = this.deps.config.presenceProvider === "off" ? "disabled" : "idle";
  }

  private async ensureDiscordClient(): Promise<DiscordRpcClient | null> {
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
  return "missing";
}

export function buildPresenceSnapshot({
  status,
  provider,
  privacy,
  clientIdSource,
  unavailableUntilRestart,
}: {
  readonly status: PresenceStatus;
  readonly provider: "off" | "discord";
  readonly privacy: "full" | "private";
  readonly clientIdSource: PresenceClientIdSource;
  readonly unavailableUntilRestart: boolean;
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
    return {
      provider,
      status: "unavailable",
      privacy,
      clientIdSource,
      canConnect: false,
      detail: "unavailable until settings reconnect",
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
