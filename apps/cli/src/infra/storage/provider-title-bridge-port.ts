import type { ProviderTitleBridgeRepository } from "@kunai/storage";
import type { ProviderTitleBridgePort } from "@kunai/types";

export function createProviderTitleBridgePort(
  repository: ProviderTitleBridgeRepository,
): ProviderTitleBridgePort {
  return {
    get: ({ providerId, catalogKind, catalogId }) =>
      repository.get(providerId, catalogKind, catalogId),
    set: ({ providerId, catalogKind, catalogId, nativeId }) =>
      repository.set(providerId, catalogKind, catalogId, nativeId),
  };
}
