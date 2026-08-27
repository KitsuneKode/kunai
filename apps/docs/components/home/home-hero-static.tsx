import { KunaiFoxLive } from "@/components/brand/kunai-fox-live";
import { HeroProofRow } from "@/components/home/hero-proof-row";
import { HomeStarCta } from "@/components/home/home-star-cta";
import { CopyButton } from "@/components/ui/copy-button";
import { homeHero } from "@/lib/home-content";
import { CANONICAL_INSTALL, NATIVE_INSTALL_PS1 } from "@/lib/install-commands";
import { IconArrowRight } from "@tabler/icons-react";
import Link from "next/link";

type HomeHeroStaticProps = {
  readonly cliVersion: string;
  readonly providerCount: number;
};

export function HomeHeroStatic({ cliVersion, providerCount }: HomeHeroStaticProps) {
  const installCommand = homeHero.installCommands[0] ?? CANONICAL_INSTALL;

  return (
    <section className="kunai-hero-static kunai-reveal flex flex-col justify-center">
      <div className="kunai-hero-fox">
        <KunaiFoxLive pose="idle" alertPose="wait" size={120} />
      </div>
      <p className="kunai-eyebrow">{homeHero.eyebrow}</p>
      <h1 className="kunai-display-title mt-3 max-w-3xl text-balance">{homeHero.title}</h1>
      <p className="kunai-type-body text-fd-muted-foreground mt-4 max-w-2xl text-pretty">
        {homeHero.description}
      </p>

      {/* Both platforms sit together: one install decision, made once. The
          Windows row used to sit below the CTAs, orphaned from its peer. */}
      <div className="kunai-hero-install mt-7">
        <code className="kunai-code-row">
          <span className="kunai-hero-install__os">Linux / macOS</span>
          <span className="kunai-hero-install__cmd">{installCommand}</span>
          <CopyButton text={installCommand} label="hero-install" />
        </code>
        <code className="kunai-code-row">
          <span className="kunai-hero-install__os">Windows</span>
          <span className="kunai-hero-install__cmd">{NATIVE_INSTALL_PS1}</span>
          <CopyButton text={NATIVE_INSTALL_PS1} label="hero-install-windows" />
        </code>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Link className="kunai-button kunai-button-primary" href={homeHero.primaryCta.href}>
          <span>{homeHero.primaryCta.label}</span>
          <IconArrowRight className="ml-1.5 size-4" stroke={1.5} />
        </Link>
        <Link className="kunai-button border-fd-border" href={homeHero.secondaryCta.href}>
          {homeHero.secondaryCta.label}
        </Link>
        <HomeStarCta />
      </div>

      <HeroProofRow cliVersion={cliVersion} providerCount={providerCount} />
    </section>
  );
}
