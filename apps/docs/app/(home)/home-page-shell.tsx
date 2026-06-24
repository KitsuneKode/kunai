import { GuideLinkGrid } from "@/components/home/guide-link-grid";
import { HomeHeroStatic } from "@/components/home/home-hero-static";
import type {
  HomeCliOption,
  HomeCommandMetadata,
  HomeProviderMetadata,
} from "@/components/home/types";
import { SectionHeading } from "@/components/ui/section-heading";
import { codeMetadata } from "@/lib/code-metadata";
import { homeFlow, homeHero, homeHighlights, homeProof, homeSections } from "@/lib/home-content";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

import HomePageInteractive from "./home-page-interactive";

type HomePageShellProps = {
  readonly providers: readonly HomeProviderMetadata[];
  readonly commands: readonly HomeCommandMetadata[];
  readonly flags: readonly HomeCliOption[];
};

export default function HomePageShell({ providers, commands, flags }: HomePageShellProps) {
  const proofItems = homeProof.map((item) => {
    if (item.label !== "Runtime model") return item;
    return {
      ...item,
      detail: `Terminal-first. ${codeMetadata.commandCount} shell commands across context groups. ${codeMetadata.providerIds.length} provider modules. 1 SQLite history DB. Predictable daily use.`,
    };
  });

  return (
    <main className="kunai-home relative mx-auto min-h-[100dvh] w-[min(1400px,calc(100vw-32px))] overflow-x-hidden py-8 max-md:w-[min(760px,calc(100vw-20px))]">
      <HomeHeroStatic />

      <noscript>
        <p className="text-fd-muted-foreground mb-8 text-sm leading-relaxed">
          JavaScript is disabled. Browse <Link href="/docs">documentation</Link>,{" "}
          <Link href="/docs/users/getting-started">getting started</Link>, or{" "}
          <Link href="/docs/users/troubleshooting">troubleshooting</Link> directly.
        </p>
      </noscript>

      <HomePageInteractive
        providers={providers}
        commands={commands}
        flags={flags}
        cliVersion={codeMetadata.cliVersion}
        runtimeBaseline={codeMetadata.runtimeBaseline}
      />

      <section className="kunai-flow-section">
        <SectionHeading
          eyebrow="Playback path"
          title="One readable path from intent to recovery."
        />
        <div className="kunai-flow">
          {homeFlow.map((step, index) => (
            <article
              className={`kunai-flow-card premium-card-hover kunai-state-${step.state} flex flex-col justify-between`}
              key={step.title}
            >
              <div>
                <div className="flex items-start justify-between">
                  <span className="kunai-flow-index">{String(index + 1).padStart(2, "0")}</span>
                </div>
                <h3 className="kunai-type-title mt-5 text-lg">{step.title}</h3>
                <p className="kunai-type-body mt-3 text-xs">{step.description}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="kunai-band">
        <p className="kunai-eyebrow">Experience promise</p>
        <h2 className="kunai-display-title">Designed for provider drift.</h2>
        <div className="kunai-highlight-grid mt-6">
          {homeHighlights.map((item) => (
            <article className="kunai-highlight premium-card-hover" key={item.label}>
              <span className="kunai-step-label">{item.label}</span>
              <p className="kunai-type-body mt-4 text-sm">{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="kunai-docs-section">
        <SectionHeading eyebrow="Guides map" title="Pick a guide by operational role." />
        <div className="grid gap-6">
          {homeSections.map((section) => (
            <GuideLinkGrid key={section.title} section={section} />
          ))}
        </div>
      </section>

      <section className="kunai-proof-section">
        <SectionHeading eyebrow="Reliability posture" title="Synced from the running CLI." />
        <div className="kunai-proof-grid grid grid-cols-3 gap-6 max-lg:grid-cols-1">
          {proofItems.map((item) => (
            <article className="kunai-proof premium-card-hover" key={item.label}>
              <span className="kunai-step-label text-[9px]">{item.label}</span>
              <p className="kunai-type-mono kunai-type-title mt-3 text-2xl md:text-3xl">
                {item.value}
              </p>
              <p className="kunai-type-body mt-3 text-xs">{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="kunai-final kunai-surface-shell p-2">
        <div className="kunai-surface-shell__inner flex flex-col gap-6 p-8 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="kunai-eyebrow">Start here</p>
            <h2 className="kunai-display-title max-w-2xl text-3xl md:text-4xl">
              Install once. Keep the stream pipeline diagnostic-rich.
            </h2>
          </div>
          <div className="flex shrink-0 flex-wrap gap-4">
            <Link
              className="kunai-button kunai-button-primary shadow-lg"
              href={homeHero.primaryCta.href}
            >
              <span>{homeHero.primaryCta.label}</span>
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </Link>
            <Link
              className="kunai-button border-fd-border hover:border-fd-primary"
              href="/docs/users/diagnostics-and-reporting"
            >
              Debug a session
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
