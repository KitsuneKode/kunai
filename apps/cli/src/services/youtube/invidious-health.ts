import { fetchHealthyInvidiousInstances } from "@kunai/providers/youtube";

export type InvidiousHealthProbe = {
  readonly ok: boolean;
  readonly instance: string | null;
  readonly latencyMs: number | null;
  readonly instanceCount?: number;
  readonly error?: string;
};

export async function probeInvidiousHealth(options: {
  readonly preferredInstanceUrl?: string;
  readonly timeoutMs?: number;
}): Promise<InvidiousHealthProbe> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? 8_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const instances = await fetchHealthyInvidiousInstances({
      preferredInstanceUrl: options.preferredInstanceUrl,
      signal: controller.signal,
    });
    if (instances.length === 0) {
      return {
        ok: false,
        instance: null,
        latencyMs: Date.now() - startedAt,
        instanceCount: 0,
        error: "No Invidious instances available",
      };
    }

    const [instance] = instances;
    if (!instance) {
      return {
        ok: false,
        instance: null,
        latencyMs: Date.now() - startedAt,
        instanceCount: 0,
        error: "No Invidious instances available",
      };
    }

    const response = await fetch(`${instance}/api/v1/stats`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        ok: false,
        instance,
        latencyMs: Date.now() - startedAt,
        instanceCount: instances.length,
        error: `HTTP ${response.status}`,
      };
    }
    return {
      ok: true,
      instance,
      latencyMs: Date.now() - startedAt,
      instanceCount: instances.length,
    };
  } catch (error) {
    return {
      ok: false,
      instance: options.preferredInstanceUrl?.trim() || null,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Invidious probe failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}
