import { KunaiFox } from "@/components/brand/kunai-fox";
import { KunaiFoxLive } from "@/components/brand/kunai-fox-live";
import { HomeBento } from "@/components/home/home-bento";
import { HomeFlowTimeline } from "@/components/home/home-flow-timeline";
import { HomeHeroStatic } from "@/components/home/home-hero-static";
import { HomeOpenSource } from "@/components/home/home-open-source";
import { HomeStarCta } from "@/components/home/home-star-cta";
import { HomeTerminalIsland } from "@/components/home/home-terminal-island";
import { HomeTerminalStatic } from "@/components/home/home-terminal-static";
import { ProviderSummaryCard } from "@/components/home/provider-summary-card";
import { StartHereCards } from "@/components/home/start-here-cards";
import type { HomeCommandMetadata, HomeProviderMetadata } from "@/components/home/types";
import { WorkshopShowcase } from "@/components/home/workshop-showcase";
import { CopyButton } from "@/components/ui/copy-button";
import { SectionHeading } from "@/components/ui/section-heading";
import { homeFlow, homeHero, homeHighlights, homeStartCards } from "@/lib/home-content";
import type { ProviderSummary } from "@/lib/home-presenters";
import { CANONICAL_INSTALL } from "@/lib/install-commands";
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
  readonly usageLine?: ReactNode;
};

/**
 * Section order is the argument the page makes.
 *
 * The install block used to sit directly under the hero, asking for a shell
 * command before the page had said what Kunai plays or shown a provider. It now
 * follows the walk-through, the daily-use band, and the provider table, so the
 * ask arrives after the reasons. The hero still carries both install commands
 * for anyone who arrived already convinced, and `#install` still resolves for
 * every link that points at it.
 *
 * The one ask for money comes after the guides and next to the free ways to
 * help, so it is never the first thing a visitor is asked for. The maintainer's
 * other projects follow it, just before the last install prompt: someone who
 * has read this far trusts one tool and is the likeliest to want the next.
 */
export default function HomePageShell({
  providers,
  paletteCommands,
  allCommands,
  providerSummary,
  cliVersion,
  runtimeBaseline,
  usageLine,
}: HomePageShellProps) {
  return (
    <main className="kunai-home relative mx-auto min-h-[100dvh] w-[min(1400px,calc(100vw-32px))] overflow-x-hidden py-8 max-md:w-[min(760px,calc(100vw-20px))]">
      <section className="kunai-home-hero grid items-center gap-10 pb-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <HomeHeroStatic cliVersion={cliVersion} providerCount={providers.length} />
        {/* She sits on the top edge of the terminal, looking out at the page. That
            puts the mascot beside the product instead of stacked above the
            headline, where she used to push the h1 a third of the way down. The
            wrapper, not the plane, is her positioning context: the plane clips
            its contents to its rounded border, which would cut her off at the
            ledge she is sitting on. */}
        <div className="kunai-hero-terminal-wrap">
          <div className="kunai-hero-perch" aria-hidden="true">
            <KunaiFoxLive pose="watch" alertPose="idle" size={104} />
          </div>
          <div className="kunai-hero-terminal-plane flex flex-col">
            <HomeTerminalIsland
              providers={providers}
              paletteCommands={paletteCommands}
              allCommands={allCommands}
              cliVersion={cliVersion}
              runtimeBaseline={runtimeBaseline}
              fallback={
                <HomeTerminalStatic cliVersion={cliVersion} runtimeBaseline={runtimeBaseline} />
              }
            />
          </div>
        </div>
      </section>

      <noscript>
        <p className="text-fd-muted-foreground mb-8 text-sm leading-relaxed">
          The terminal above is a preview, not a live shell. Browse{" "}
          <Link href="/docs">documentation</Link>,{" "}
          <Link href="/docs/users/getting-started">getting started</Link>, or{" "}
          <Link href="/docs/users/troubleshooting">troubleshooting</Link> directly.
        </p>
      </noscript>

      <section className="kunai-home-steps kunai-flow-section">
        <SectionHeading
          title="From search to mpv in three steps."
          description="It all runs from one keyboard-driven session, and providers, history and recovery are each one command away."
        />
        <HomeFlowTimeline steps={homeFlow} />
      </section>

      <section className="kunai-home-highlights kunai-flow-section">
        <SectionHeading title="Everything stays one keystroke away." />
        {usageLine}
        <div className="mt-10">
          <HomeBento highlights={homeHighlights} providers={providers} />
        </div>
      </section>

      <section className="kunai-home-providers">
        <SectionHeading
          title="Direct adapters on your machine."
          description="Kunai resolves streams locally. See the provider guide for status, capabilities, and setup notes."
        />
        <ProviderSummaryCard summary={providerSummary} />
      </section>

      <HomePageInteractive />

      <section className="kunai-home-start kunai-docs-section">
        <SectionHeading title="Pick the guide that matches your next step." />
        <StartHereCards items={homeStartCards} />
      </section>

      <section className="kunai-home-open kunai-flow-section">
        <SectionHeading
          title="Free, open, and kept alive in the open."
          description="Who makes it, how to help for free, and what sponsorship pays for."
        />
        <HomeOpenSource />
      </section>

      <section className="kunai-home-workshop kunai-flow-section">
        <SectionHeading
          title="More from the same workshop."
          description="Other tools KitsuneKode makes and maintains. Originals only, no forks."
        />
        <WorkshopShowcase />
      </section>

      <section className="kunai-home-final kunai-final kunai-surface-shell p-2">
        <div className="kunai-surface-shell__inner flex flex-col gap-6 p-8 md:flex-row md:items-center md:justify-between">
          <KunaiFox className="kunai-final-fox" pose="go" size={112} animated />
          <div>
            <h2 className="kunai-display-title max-w-2xl text-3xl md:text-4xl">
              One command to install. Nothing to sign up for.
            </h2>
            <p className="kunai-type-body text-fd-muted-foreground mt-3 max-w-xl text-sm">
              Kunai is MIT licensed, has no accounts or ads, and keeps your history on your machine.
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-3">
            <code className="kunai-code-row">
              <span>{CANONICAL_INSTALL}</span>
              <CopyButton text={CANONICAL_INSTALL} label="final-install" />
            </code>
            <div className="flex flex-wrap gap-3">
              <Link
                className="kunai-button kunai-button-primary shadow-lg"
                href={homeHero.primaryCta.href}
              >
                <span>{homeHero.primaryCta.label}</span>
                <IconArrowRight className="ml-1.5 size-4" stroke={1.5} />
              </Link>
              <HomeStarCta />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
