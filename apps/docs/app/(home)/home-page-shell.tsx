import { HomeHeroStatic } from "@/components/home/home-hero-static";
import { HomeTerminalIsland } from "@/components/home/home-terminal-island";
import { ProviderSummaryCard } from "@/components/home/provider-summary-card";
import { StartHereCards } from "@/components/home/start-here-cards";
import type { HomeCommandMetadata, HomeProviderMetadata } from "@/components/home/types";
import { SectionHeading } from "@/components/ui/section-heading";
import { homeFlow, homeHero, homeHighlights, homeStartCards } from "@/lib/home-content";
import type { ProviderSummary } from "@/lib/home-presenters";
import { IconArrowRight } from "@tabler/icons-react";
import Link from "next/link";
import type { ReactNode } from "react";

import HomePageInteractive from "./home-page-interactive";

type HomePageShellProps = {
  readonly providers: readonly HomeProviderMetadata[];
  readonly paletteCommands: readonly HomeCommandMetadata[];
  readonly allCommands: readonly HomeCommandMetadata[];
  readonly providerSummary: ProviderSummary;
  readonly cliVersion: string;
  readonly runtimeBaseline: { readonly bun: string; readonly mpv: string };
  readonly telemetryLine?: ReactNode;
};

export default function HomePageShell({
  providers,
  paletteCommands,
  allCommands,
  providerSummary,
  cliVersion,
  runtimeBaseline,
  telemetryLine,
}: HomePageShellProps) {
  return (
    <main className="kunai-home relative mx-auto min-h-[100dvh] w-[min(1400px,calc(100vw-32px))] overflow-x-hidden py-8 max-md:w-[min(760px,calc(100vw-20px))]">
      <section className="kunai-home-hero grid items-center gap-10 pb-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <HomeHeroStatic />
        <div className="kunai-hero-terminal-plane flex flex-col">
          <HomeTerminalIsland
            providers={providers}
            paletteCommands={paletteCommands}
            allCommands={allCommands}
            cliVersion={cliVersion}
            runtimeBaseline={runtimeBaseline}
          />
        </div>
      </section>

      <noscript>
        <p className="text-fd-muted-foreground mb-8 text-sm leading-relaxed">
          JavaScript is disabled. Browse <Link href="/docs">documentation</Link>,{" "}
          <Link href="/docs/users/getting-started">getting started</Link>, or{" "}
          <Link href="/docs/users/troubleshooting">troubleshooting</Link> directly.
        </p>
      </noscript>

      <HomePageInteractive />

      <section className="kunai-home-steps kunai-flow-section">
        <SectionHeading
          title="From search to mpv in three steps."
          description="Kunai keeps the shell readable while providers, history, and recovery stay one command away."
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

      <section className="kunai-home-highlights kunai-band">
        <h2 className="kunai-display-title">Built for daily playback, not demos.</h2>
        <ul className="kunai-highlight-list mt-6">
          {homeHighlights.map((item) => (
            <li className="kunai-highlight-row" key={item.label}>
              <span className="kunai-step-label">{item.label}</span>
              <p className="kunai-type-body m-0 text-sm">{item.detail}</p>
            </li>
          ))}
        </ul>
        {telemetryLine}
      </section>

      <section className="kunai-home-providers">
        <SectionHeading
          title="Direct adapters on your machine."
          description="Kunai resolves streams locally. See the provider guide for status, capabilities, and setup notes."
        />
        <ProviderSummaryCard summary={providerSummary} />
      </section>

      <section className="kunai-home-start kunai-docs-section">
        <SectionHeading title="Pick the guide that matches your next step." />
        <StartHereCards items={homeStartCards} />
      </section>

      <section className="kunai-home-final kunai-final kunai-surface-shell p-2">
        <div className="kunai-surface-shell__inner flex flex-col gap-6 p-8 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="kunai-display-title max-w-2xl text-3xl md:text-4xl">
              Install once, then keep playback predictable.
            </h2>
            <p className="kunai-type-body text-fd-muted-foreground mt-3 max-w-xl text-sm">
              Recovery stays in the shell. No shared public relay — when you need geo metadata help,
              you own the relay URL.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-4">
            <Link
              className="kunai-button kunai-button-primary shadow-lg"
              href={homeHero.primaryCta.href}
            >
              <span>{homeHero.primaryCta.label}</span>
              <IconArrowRight className="ml-1.5 size-4" stroke={1.5} />
            </Link>
            <Link className="kunai-button border-fd-border hover:border-fd-primary" href="/docs">
              Browse docs
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
