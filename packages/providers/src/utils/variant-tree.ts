import type { ProviderVariantCandidate } from "@kunai/types";

export interface VariantBuilderOptions {
  providerId: string;
  sourceId: string;
}

/**
 * A helper to construct and group ProviderVariantCandidates.
 * Ensures consistent taxonomy across providers.
 */
export class VariantTreeBuilder {
  private variants: ProviderVariantCandidate[] = [];

  constructor(private options: VariantBuilderOptions) {}

  addVariant(variant: Omit<ProviderVariantCandidate, "id" | "providerId" | "sourceId">): this {
    const idParts = [
      this.options.providerId,
      this.options.sourceId,
      variant.presentation || "unknown",
      variant.flavorLabel || "default",
      variant.qualityLabel || "auto",
      variant.subtitleDelivery || "unknown",
    ];

    // Create deterministic ID
    const id = `var_${Buffer.from(idParts.join(":")).toString("base64url").substring(0, 16)}`;

    this.variants.push({
      ...variant,
      id,
      providerId: this.options.providerId,
      sourceId: this.options.sourceId,
    });

    return this;
  }

  build(): ProviderVariantCandidate[] {
    // Sort variants logically (Sub before Dub, Higher rank before lower)
    return [...this.variants].sort((a, b) => {
      // 1. Sort by presentation (sub > dub > raw)
      if (a.presentation !== b.presentation) {
        if (a.presentation === "sub") return -1;
        if (b.presentation === "sub") return 1;
        if (a.presentation === "dub") return -1;
        if (b.presentation === "dub") return 1;
      }

      // 2. Sort by Quality (high > low)
      if ((a.qualityRank || 0) !== (b.qualityRank || 0)) {
        return (b.qualityRank || 0) - (a.qualityRank || 0);
      }

      // 3. Fallback to alpha sort on label
      return (a.label || "").localeCompare(b.label || "");
    });
  }
}
