import { HeroKindsRow } from "@/components/home/hero-kinds-row";
import { HeroProofRow } from "@/components/home/hero-proof-row";
import { InstallDock } from "@/components/home/install-dock";
import { homeHero } from "@/lib/home-content";
import { CANONICAL_INSTALL, NATIVE_INSTALL_PS1 } from "@/lib/install-commands";
import { IconArrowRight } from "@tabler/icons-react";
import Link from "next/link";

type HomeHeroStaticProps = {
  readonly publishedVersion?: string;
  readonly providerCount: number;
};

export function HomeHeroStatic({ publishedVersion, providerCount }: HomeHeroStaticProps) {
  const installCommand = homeHero.installCommands[0] ?? CANONICAL_INSTALL;

  return (
    <div className="kunai-hero-static mx-auto flex max-w-3xl flex-col items-center text-center">
      <h1 className="kunai-hero-h1 text-balance">{homeHero.title}</h1>
      <p className="kunai-hero-lead mt-5 text-pretty">{homeHero.description}</p>

      {/* Kept in server HTML for crawlers and screen readers; visual mode controls live in the ribbon above. */}
      <div className="sr-only">
        <HeroKindsRow />
      </div>

      <div className="mt-8 w-full max-w-[38rem]">
        <InstallDock
          unixCommand={installCommand}
          windowsCommand={NATIVE_INSTALL_PS1}
          labelPrefix="hero-install"
        />
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link className="kunai-button kunai-button-primary" href={homeHero.primaryCta.href}>
          <span>{homeHero.primaryCta.label}</span>
          <IconArrowRight className="ml-1.5 size-4" stroke={1.5} />
        </Link>
        <Link className="kunai-button kunai-button-quiet" href={homeHero.secondaryCta.href}>
          {homeHero.secondaryCta.label}
        </Link>
      </div>

      <HeroProofRow publishedVersion={publishedVersion} providerCount={providerCount} />
    </div>
  );
}
