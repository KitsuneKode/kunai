import type {
  EndpointHealthPort,
  ProviderAuthPort,
  ProviderFetchPort,
  ProviderId,
  ProviderModule,
  ProviderRetryPolicy,
  ProviderRuntime,
  ProviderRuntimeContext,
  ProviderTitleBridgePort,
  ProviderTraceEvent,
} from "@kunai/types";

import type { CoreProviderManifest } from "./provider-manifest";

export interface CoreProviderModule<
  TContext extends ProviderRuntimeContext = ProviderRuntimeContext,
> extends ProviderModule<TContext> {
  readonly manifest: CoreProviderManifest;
}

export const DEFAULT_PROVIDER_RETRY_POLICY: ProviderRetryPolicy = {
  maxAttempts: 2,
  backoff: "none",
};

export function createProviderRuntimeContext({
  now = () => new Date().toISOString(),
  providerId,
  signal,
  retryPolicy = DEFAULT_PROVIDER_RETRY_POLICY,
  fetch,
  auth,
  endpointHealth,
  titleBridge,
  emit,
}: {
  readonly now?: () => string;
  readonly providerId?: ProviderId;
  readonly signal?: AbortSignal;
  readonly retryPolicy?: ProviderRetryPolicy;
  readonly fetch?: ProviderFetchPort;
  readonly auth?: ProviderAuthPort;
  readonly endpointHealth?: EndpointHealthPort;
  readonly titleBridge?: ProviderTitleBridgePort;
  readonly emit?: (event: ProviderTraceEvent) => void;
} = {}): ProviderRuntimeContext {
  return {
    providerId,
    now,
    signal,
    retryPolicy,
    fetch,
    auth,
    endpointHealth,
    titleBridge,
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
