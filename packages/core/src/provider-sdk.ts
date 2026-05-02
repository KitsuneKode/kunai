import type {
  ProviderId,
  ProviderModule,
  ProviderRetryPolicy,
  ProviderRuntime,
  ProviderRuntimeContext,
  ProviderTraceEvent,
} from "@kunai/types";

import type { CoreProviderManifest } from "./provider-manifest";

export interface CoreProviderModule<
  TContext extends ProviderRuntimeContext = ProviderRuntimeContext,
> extends ProviderModule<TContext> {
  readonly manifest: CoreProviderManifest;
}

export const DEFAULT_PROVIDER_RETRY_POLICY: ProviderRetryPolicy = {
  maxAttempts: 1,
  backoff: "none",
};

export function createProviderRuntimeContext({
  now = () => new Date().toISOString(),
  signal,
  retryPolicy = DEFAULT_PROVIDER_RETRY_POLICY,
  emit,
}: {
  readonly now?: () => string;
  readonly signal?: AbortSignal;
  readonly retryPolicy?: ProviderRetryPolicy;
  readonly emit?: (event: ProviderTraceEvent) => void;
} = {}): ProviderRuntimeContext {
  return {
    now,
    signal,
    retryPolicy,
    emit,
  };
}

export function createProviderTraceEvent({
  now = () => new Date().toISOString(),
  ...event
}: Omit<ProviderTraceEvent, "at"> & { readonly now?: () => string }): ProviderTraceEvent {
  return {
    ...event,
    at: now(),
  };
}

export function assertRuntimeAllowed({
  providerId,
  runtime,
  allowedRuntimes,
}: {
  readonly providerId: ProviderId;
  readonly runtime: ProviderRuntime;
  readonly allowedRuntimes: readonly ProviderRuntime[];
}): void {
  if (!allowedRuntimes.includes(runtime)) {
    throw new Error(`${providerId} requires ${runtime}, but that runtime is not allowed`);
  }
}

export function assertProviderModuleMatchesManifest(module: CoreProviderModule): void {
  if (module.providerId !== module.manifest.id) {
    throw new Error(
      `Provider module id ${module.providerId} does not match manifest id ${module.manifest.id}`,
    );
  }
}
