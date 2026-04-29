import type { CoreProviderManifest } from "../provider-manifest";

type ProviderManifestInput = Omit<CoreProviderManifest, "status"> &
  Partial<Pick<CoreProviderManifest, "status">>;

export function defineProviderManifest(input: ProviderManifestInput): CoreProviderManifest {
  return {
    status: "production",
    ...input,
  };
}
