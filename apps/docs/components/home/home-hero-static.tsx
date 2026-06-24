import { CopyButton } from "@/components/ui/copy-button";
import { homeHero } from "@/lib/home-content";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

export function HomeHeroStatic() {
  const installCommand = homeHero.installCommands[0] ?? "bun install -g @kitsunekode/kunai";

  return (
    <section className="kunai-hero-static border-fd-border mb-10 border-b pb-10">
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
          <ArrowRight className="ml-1.5 h-4 w-4" />
        </Link>
        <Link className="kunai-button border-fd-border" href={homeHero.secondaryCta.href}>
          {homeHero.secondaryCta.label}
        </Link>
      </div>
    </section>
  );
}
