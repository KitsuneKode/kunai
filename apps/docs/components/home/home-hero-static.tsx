import { CopyButton } from "@/components/ui/copy-button";
import { homeHero } from "@/lib/home-content";
import { CANONICAL_INSTALL } from "@/lib/install-commands";
import { IconArrowRight } from "@tabler/icons-react";
import Link from "next/link";

export function HomeHeroStatic() {
  const installCommand = homeHero.installCommands[0] ?? CANONICAL_INSTALL;

  return (
    <section className="kunai-hero-static kunai-reveal flex flex-col justify-center">
      <p className="kunai-eyebrow">{homeHero.eyebrow}</p>
      <h1 className="kunai-display-title mt-3 max-w-3xl text-balance">{homeHero.title}</h1>
      <p className="kunai-type-body text-fd-muted-foreground mt-4 max-w-2xl text-pretty">
        {homeHero.description}
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <code className="kunai-code-row">
          <span>{installCommand}</span>
          <CopyButton text={installCommand} label="hero-install" />
        </code>
        <Link className="kunai-button kunai-button-primary" href={homeHero.primaryCta.href}>
          <span>{homeHero.primaryCta.label}</span>
          <IconArrowRight className="ml-1.5 size-4" stroke={1.5} />
        </Link>
        <Link className="kunai-button border-fd-border" href={homeHero.secondaryCta.href}>
          {homeHero.secondaryCta.label}
        </Link>
      </div>
    </section>
  );
}
