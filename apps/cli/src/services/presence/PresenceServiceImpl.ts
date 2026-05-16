import type { DiagnosticsStore } from "@/services/diagnostics/DiagnosticsStore";
import type { ConfigService } from "@/services/persistence/ConfigService";

import type {
  PresenceBrowseActivity,
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

type NodeBridgeRequest = {
  readonly id: number;
  readonly method: "login" | "setActivity" | "clearActivity" | "destroy";
  readonly params?: Record<string, unknown>;
};

type NodeBridgeResponse = {
  readonly id: number;
  readonly ok: boolean;
  readonly error?: string;
};

const DEFAULT_DISCORD_CLIENT_ID = "1502307419047461025";

/** Shown in diagnostics when IPC/update fails and another consumer may hold the Discord app pipe. */
const DISCORD_PRESENCE_MULTI_INSTANCE_DIAGNOSTIC =
  "Another Kunai window or discord-rpc app using the same Discord application id may contend for IPC; close other instances or disable Rich Presence there.";

export class PresenceServiceImpl implements PresenceService {
  private status: PresenceStatus = "idle";
  private discordClient: DiscordRpcClient | null = null;
  private connectPromise: Promise<DiscordRpcClient | null> | null = null;
  private unavailableUntilRestart = false;
  private unavailableReason: string | null = null;
  private unavailableRetryAtMs = 0;
  private unavailableBackoffMs = 1_000;
  private lastActivityHash: string | null = null;
  private lastActivityPayload: Record<string, unknown> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

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
    if (this.unavailableUntilRestart) {
      if (Date.now() < this.unavailableRetryAtMs) return;
      this.unavailableUntilRestart = false;
    }

    const client = await this.ensureDiscordClient();
    if (!client) return;

    try {
      const payload = buildDiscordActivity(activity, this.deps.config.presencePrivacy);
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
    if (this.unavailableUntilRestart) return;

    const client = await this.ensureDiscordClient();
    if (!client) return;

    try {
      const privacy = this.deps.config.presencePrivacy;
      const payload: Record<string, unknown> =
        privacy === "private"
          ? { type: 3, details: "Browsing with Kunai", largeImageKey: "kunai" }
          : {
              type: 3,
              details: `Browsing ${activity.view}`,
              ...(activity.detail ? { state: activity.detail } : {}),
              largeImageKey: "kunai",
            };
      const activityHash = stableJsonHash(payload);
      if (activityHash === this.lastActivityHash) return;
      await client.setActivity(payload);
      this.status = "ready";
      this.lastActivityHash = activityHash;
      this.lastActivityPayload = payload;
    } catch (error) {
      this.markUnavailable("Discord browsing presence update failed", error, {
        suspectedDuplicateDiscordConsumer: true,
      });
    }
  }

  async clearPlayback(reason: string): Promise<void> {
    this.stopHeartbeat();
    this.lastActivityPayload = null;
    if (!this.discordClient) return;
    try {
      await this.discordClient.clearActivity();
      this.deps.diagnosticsStore.record({
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
    this.stopHeartbeat();
    const client = this.discordClient;
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
      if (typeof Bun !== "undefined") {
        const bridgeClient = await createNodeBridgeDiscordClient(clientId);
        this.discordClient = bridgeClient;
        this.status = "ready";
        this.unavailableReason = null;
        this.unavailableRetryAtMs = 0;
        this.unavailableBackoffMs = 1_000;
        this.deps.diagnosticsStore.record({
          category: "presence",
          message: "Discord presence connected",
          context: { provider: "discord", transport: "node-bridge" },
        });
        return bridgeClient;
      }

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
      this.unavailableReason = null;
      this.unavailableRetryAtMs = 0;
      this.unavailableBackoffMs = 1_000;
      this.deps.diagnosticsStore.record({
        category: "presence",
        message: "Discord presence connected",
        context: { provider: "discord" },
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
    this.deps.diagnosticsStore.record({
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
      void this.sendHeartbeat();
    }, 15_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async sendHeartbeat(): Promise<void> {
    if (!this.discordClient || !this.lastActivityPayload) return;
    try {
      await this.discordClient.setActivity(this.lastActivityPayload);
    } catch {
      // Heartbeat failures are best-effort; don't spam diagnostics.
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

class NodeBridgeDiscordRpcClient implements DiscordRpcClient {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: () => void; reject: (error: Error) => void }
  >();
  private closed = false;
  private readyCallback: (() => void) | null = null;
  private readonly child: ReturnType<typeof Bun.spawn>;

  constructor(child: ReturnType<typeof Bun.spawn>) {
    this.child = child;
    if (child.stdout instanceof ReadableStream) {
      this.readStream(child.stdout, (line) => this.handleStdoutLine(line));
    }
    if (child.stderr instanceof ReadableStream) {
      this.readStream(child.stderr, () => undefined);
    }
    void child.exited.then((exitCode) => {
      if (this.closed) return;
      this.closed = true;
      for (const [, pending] of this.pending) {
        pending.reject(new Error(`Discord RPC bridge exited (${exitCode})`));
      }
      this.pending.clear();
      return undefined;
    });
  }

  on(event: "ready", callback: () => void): void {
    if (event === "ready") this.readyCallback = callback;
  }

  async login(input: { clientId: string }): Promise<void> {
    await this.request("login", { clientId: input.clientId });
    this.readyCallback?.();
  }

  async setActivity(activity: Record<string, unknown>): Promise<void> {
    await this.request("setActivity", { activity });
  }

  async clearActivity(): Promise<void> {
    await this.request("clearActivity");
  }

  async destroy(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.request("destroy");
    } finally {
      this.child.kill();
      const stdin = this.child.stdin;
      if (stdin && typeof stdin !== "number" && "end" in stdin && typeof stdin.end === "function") {
        stdin.end();
      }
    }
  }

  private request(
    method: NodeBridgeRequest["method"],
    params?: Record<string, unknown>,
  ): Promise<void> {
    if (this.closed) return Promise.reject(new Error("Discord RPC bridge closed"));

    const id = this.nextId++;
    const payload: NodeBridgeRequest = { id, method, params };
    const serialized = `${JSON.stringify(payload)}\n`;
    const promise = new Promise<void>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    const stdin = this.child.stdin;
    if (!stdin || typeof stdin === "number" || typeof stdin.write !== "function") {
      this.pending.delete(id);
      return Promise.reject(new Error("Discord RPC bridge stdin is unavailable"));
    }
    const wrote = stdin.write(serialized);
    if (wrote === 0) {
      this.pending.delete(id);
      return Promise.reject(new Error("Discord RPC bridge stdin is not writable"));
    }

    return promise;
  }

  private handleStdoutLine(line: string): void {
    let message: NodeBridgeResponse | null = null;
    try {
      message = JSON.parse(line) as NodeBridgeResponse;
    } catch {
      return;
    }
    if (!message || typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.ok) {
      pending.resolve();
      return;
    }
    pending.reject(new Error(message.error ?? "Discord RPC bridge request failed"));
  }

  private readStream(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void): void {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const pump = async (): Promise<void> => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (buffer.trim().length > 0) onLine(buffer.trim());
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex >= 0) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (line.length > 0) onLine(line);
          newlineIndex = buffer.indexOf("\n");
        }
      }
    };

    void pump();
  }
}

async function createNodeBridgeDiscordClient(clientId: string): Promise<DiscordRpcClient> {
  const nodePath = Bun.which("node");
  if (!nodePath) {
    throw new Error("node binary not found for Discord RPC bridge");
  }

  const bridgeScript = [
    "const RPC = require('discord-rpc');",
    "const readline = require('node:readline');",
    "let client = null;",
    "const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\\n');",
    "const destroyClient = async () => {",
    "  if (!client) return;",
    "  try { await client.destroy(); } catch {}",
    "  client = null;",
    "};",
    "const handle = async (line) => {",
    "  let req;",
    "  try { req = JSON.parse(line); } catch { return; }",
    "  const id = req && typeof req.id === 'number' ? req.id : -1;",
    "  try {",
    "    if (req.method === 'login') {",
    "      await destroyClient();",
    "      client = new RPC.Client({ transport: 'ipc' });",
    "      await client.login({ clientId: String(req.params?.clientId || '') });",
    "      send({ id, ok: true });",
    "      return;",
    "    }",
    "    if (req.method === 'setActivity') {",
    "      if (!client) throw new Error('not-connected');",
    "      await client.setActivity(req.params?.activity || {});",
    "      send({ id, ok: true });",
    "      return;",
    "    }",
    "    if (req.method === 'clearActivity') {",
    "      if (client) await client.clearActivity();",
    "      send({ id, ok: true });",
    "      return;",
    "    }",
    "    if (req.method === 'destroy') {",
    "      await destroyClient();",
    "      send({ id, ok: true });",
    "      return;",
    "    }",
    "    throw new Error('unsupported-method');",
    "  } catch (error) {",
    "    send({ id, ok: false, error: String(error && error.message ? error.message : error) });",
    "  }",
    "};",
    "const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });",
    "rl.on('line', (line) => { void handle(line); });",
    "process.on('SIGINT', async () => { await destroyClient(); process.exit(0); });",
    "process.on('SIGTERM', async () => { await destroyClient(); process.exit(0); });",
  ].join("");

  const child = Bun.spawn([nodePath, "-e", bridgeScript], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  const client = new NodeBridgeDiscordRpcClient(child);
  await client.login({ clientId });
  return client;
}

export function buildDiscordActivity(
  activity: PresencePlaybackActivity,
  privacy: "full" | "private",
): Record<string, unknown> {
  const episodeLabel =
    activity.title.type === "series"
      ? `Season ${activity.episode.season}, Episode ${activity.episode.episode}`
      : "Movie";
  const stateLine =
    activity.title.type === "series"
      ? `${episodeLabel} · ${activity.providerId}`
      : activity.providerId;
  const subtitleAttached = (activity.subtitleCount ?? 0) > 0;

  if (privacy === "private") {
    return {
      type: 3,
      details: "Watching with Kunai",
      state: activity.paused ? "Paused" : "Playing",
      ...(activity.paused ? {} : { startTimestamp: Math.floor(activity.startedAtMs / 1000) }),
      largeImageKey: "kunai",
      largeImageText: "Kunai",
    };
  }

  return {
    type: 3,
    details: activity.title.name,
    state: stateLine,
    ...(activity.paused ? {} : { startTimestamp: Math.floor(activity.startedAtMs / 1000) }),
    largeImageKey: "kunai",
    largeImageText: "Kunai",
    ...(subtitleAttached
      ? { smallImageKey: "subtitles", smallImageText: "Subtitles attached" }
      : {}),
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
