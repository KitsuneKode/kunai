import { homeHero } from "@/lib/home-content";

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
        <span className="kunai-hero-kinds__item" key={kind}>
          {kind}
        </span>
      ))}
      <span className="kunai-hero-kinds__hint">
        <kbd>{homeHero.kindsHint.key}</kbd> {homeHero.kindsHint.label}
      </span>
    </p>
  );
}
