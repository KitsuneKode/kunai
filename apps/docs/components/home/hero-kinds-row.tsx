import { homeHero } from "@/lib/home-content";
import type { CSSProperties } from "react";

const KIND_LANE_VAR: Record<(typeof homeHero.kinds)[number], string> = {
  Anime: "var(--home-lane-anime)",
  Series: "var(--home-lane-series)",
  Movies: "var(--home-lane-movie)",
  YouTube: "var(--home-lane-yt)",
};

/**
 * What Kunai plays, stated as text in the server-rendered HTML.
 *
 * Deliberately not links: all four modes are documented on the same providers
 * page, and four identical hrefs would be navigation theatre. The trailing hint
 * carries a real hotkey, which is what keeps this row from being an eyebrow.
 */
export function HeroKindsRow() {
  return (
    <p className="kunai-hero-kinds">
      {homeHero.kinds.map((kind) => (
        <span
          className="kunai-hero-kinds__item"
          key={kind}
          style={{ "--lane": KIND_LANE_VAR[kind] } as CSSProperties}
        >
          <span className="kunai-lane-dot" aria-hidden="true" />
          {kind}
        </span>
      ))}
      <span className="kunai-hero-kinds__hint">
        <kbd>{homeHero.kindsHint.key}</kbd> {homeHero.kindsHint.label}
      </span>
    </p>
  );
}
