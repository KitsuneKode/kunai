import type { DiagnosticsStore } from "@/services/diagnostics/DiagnosticsStore";
import type { ConfigService, KitsuneConfig } from "@/services/persistence/ConfigService";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";
import { resolveTuning } from "@/services/persistence/tuning";
import { PresenceServiceImpl } from "@/services/presence/PresenceServiceImpl";

type DiscordPresenceSmokePayload = {
  readonly ok: boolean;
  readonly skipped: boolean;
  readonly provider: "discord";
  readonly status: string;
  readonly clientIdSource: string;
  readonly diagnostics: readonly string[];
  readonly error?: string;
};

function printPayload(payload: DiscordPresenceSmokePayload): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function createConfig(): ConfigService {
  const raw: KitsuneConfig = {
    ...DEFAULT_CONFIG,
    presenceProvider: "discord",
    presencePrivacy: process.env.KUNAI_LIVE_DISCORD_PRIVACY === "private" ? "private" : "full",
    presenceDiscordClientId: process.env.KUNAI_DISCORD_CLIENT_ID ?? "",
  };
  return {
    ...raw,
    tuning: resolveTuning(raw.tuningOverrides),
    getRaw: () => ({ ...raw }),
    update: async () => undefined,
    applySessionOverrides: () => undefined,
    save: async () => undefined,
    flushPending: async () => undefined,
    reset: async () => undefined,
  };
}

function createDiagnostics(): DiagnosticsStore & { messages: string[] } {
  const messages: string[] = [];
  return {
    messages,
    record(event) {
      messages.push(event.message);
    },
    getRecent: () => [],
    getSnapshot: () => [],
    clear() {
      messages.length = 0;
    },
  };
}

if (process.env.KUNAI_LIVE_DISCORD_PRESENCE !== "1") {
  printPayload({
    ok: true,
    skipped: true,
    provider: "discord",
    status: "skipped",
    clientIdSource: "not-requested",
    diagnostics: ["Set KUNAI_LIVE_DISCORD_PRESENCE=1 to run the local Discord IPC smoke."],
  });
} else {
  const diagnostics = createDiagnostics();
  const service = new PresenceServiceImpl({
    config: createConfig(),
    diagnostics: diagnostics,
  });

  try {
    const connected = await service.connect();
    await service.updateBrowsing({ view: "live smoke", detail: "Discord IPC check" });
    await service.updatePlayback({
      mode: "series",
      title: { id: "discord-smoke", type: "series", name: "Kunai Presence Smoke" },
      episode: { season: 1, episode: 1 },
      providerId: "smoke",
      startedAtMs: Date.now() - 90_000,
      positionSeconds: 90,
      durationSeconds: 300,
      subtitleCount: 0,
    });
    await service.clearPlayback("live-smoke-complete");
    await service.shutdown();

    printPayload({
      ok: connected.status === "ready" || service.getStatus() === "idle",
      skipped: false,
      provider: "discord",
      status: connected.status,
      clientIdSource: connected.clientIdSource,
      diagnostics: diagnostics.messages,
    });
  } catch (error) {
    await service.shutdown().catch(() => undefined);
    printPayload({
      ok: false,
      skipped: false,
      provider: "discord",
      status: service.getStatus(),
      clientIdSource: service.getSnapshot().clientIdSource,
      diagnostics: diagnostics.messages,
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  }
}
