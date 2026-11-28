import { KunaiFox } from "@/components/brand/kunai-fox";
import { KunaiFoxLive } from "@/components/brand/kunai-fox-live";
import { CommandDockIsland } from "@/components/home/command-dock-island";
import { HeroSceneRibbon } from "@/components/home/hero-scene-ribbon";
import { HomeBento } from "@/components/home/home-bento";
import { HomeFlowTimeline } from "@/components/home/home-flow-timeline";
import { HomeHeroStatic } from "@/components/home/home-hero-static";
import { HomeOpenSource } from "@/components/home/home-open-source";
import { DirectorySectionAnchor, TerminalStageAnchor } from "@/components/home/home-stage-anchors";
import { HomeStageProvider } from "@/components/home/home-stage-context";
import { HomeStarCta, HomeStarCtaFallback } from "@/components/home/home-star-cta";
import { HomeTerminalIsland } from "@/components/home/home-terminal-island";
import { HomeTerminalStatic } from "@/components/home/home-terminal-static";
import { ProviderDirectory } from "@/components/home/provider-directory";
import { ProviderSummaryCard } from "@/components/home/provider-summary-card";
import { SpotlightField } from "@/components/home/spotlight-field";
import { StartHereCards } from "@/components/home/start-here-cards";
import type { HomeCommandMetadata, HomeProviderMetadata } from "@/components/home/types";
import { WorkshopShowcase, WorkshopShowcaseFallback } from "@/components/home/workshop-showcase";
import { CopyButton } from "@/components/ui/copy-button";
import { SectionHeading } from "@/components/ui/section-heading";
import { homeFlow, homeHero, homeHighlights, homeStartCards } from "@/lib/home-content";
import type { ProviderSummary } from "@/lib/home-presenters";
import { CANONICAL_INSTALL } from "@/lib/install-commands";
import { IconArrowRight } from "@tabler/icons-react";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import HomePageInteractive from "./home-page-interactive";

type HomePageShellProps = {
  readonly providers: readonly HomeProviderMetadata[];
  readonly paletteCommands: readonly HomeCommandMetadata[];
  readonly allCommands: readonly HomeCommandMetadata[];
  readonly providerSummary: ProviderSummary;
  readonly cliVersion: string;
  readonly publishedVersion?: string;
  readonly runtimeBaseline: { readonly bun: string; readonly mpv: string };
  readonly usageLine?: ReactNode;
};

export default function HomePageShell({
  providers,
  paletteCommands,
  allCommands,
  providerSummary,
  cliVersion,
  publishedVersion,
  runtimeBaseline,
  usageLine,
}: HomePageShellProps) {
  const starCtaNode = (
    <Suspense fallback={<HomeStarCtaFallback />}>
      <HomeStarCta />
    </Suspense>
  );

  return (
    <HomeStageProvider>
      <main className="kunai-home relative mx-auto min-h-[100dvh] w-full overflow-x-clip pb-20">
        <div className="kunai-home-top-light" aria-hidden="true" />

        <div className="kunai-home-col">
          {/* 01 · Hero with Perfolios-inspired fanned mode ribbon and centered editorial column */}
          <section className="kunai-home-hero">
            <HeroSceneRibbon />
            <HomeHeroStatic publishedVersion={publishedVersion} providerCount={providers.length} />
          </section>
        </div>

        {/* 02 · Full-width Ghostty/Tahoe terminal stage with live lane beam & Kanna perched */}
        <section className="kunai-home-stage kunai-home-col--wide">
          <TerminalStageAnchor className="kunai-hero-terminal-wrap">
            <div className="kunai-hero-perch" aria-hidden="true">
              <KunaiFoxLive pose="watch" alertPose="idle" size={104} />
            </div>
            <div className="kunai-hero-terminal-plane flex flex-col">
              <span className="kunai-terminal-beam" aria-hidden="true" />
              <HomeTerminalIsland
                providers={providers}
                paletteCommands={paletteCommands}
                allCommands={allCommands}
                cliVersion={cliVersion}
                publishedVersion={publishedVersion}
                runtimeBaseline={runtimeBaseline}
                fallback={
                  <HomeTerminalStatic
                    cliVersion={cliVersion}
                    publishedVersion={publishedVersion}
                    runtimeBaseline={runtimeBaseline}
                  />
                }
              />
            </div>
          </TerminalStageAnchor>

          <noscript>
            <p className="mt-4 text-center text-sm leading-relaxed text-[var(--home-text-3)]">
              The terminal above is a preview, not a live shell. Browse{" "}
              <Link href="/docs">documentation</Link>,{" "}
              <Link href="/docs/users/getting-started">getting started</Link>, or{" "}
              <Link href="/docs/users/troubleshooting">troubleshooting</Link> directly.
            </p>
          </noscript>
        </section>

        {/* 03 · Flow: Kanna walks through the three steps */}
        <div className="kunai-home-col">
          <section className="kunai-home-steps kunai-home-section">
            <SectionHeading
              variant="home"
              animate={false}
              title="From search to mpv in three steps."
              description="One keyboard-driven session from query to player — with providers, history, and recovery always one command away."
            />
            <HomeFlowTimeline steps={homeFlow} />
          </section>
        </div>

        {/* 04 · Interactive Adapter Directory on alternating architectural band */}
        <div className="kunai-band-surface">
          <div className="kunai-home-col--wide">
            <DirectorySectionAnchor className="kunai-home-providers kunai-home-section">
              <SectionHeading
                variant="home"
                animate={false}
                title="Direct adapters on your machine."
                description="Hover any row to inspect its capabilities, filter by lane, or jump straight into the preview terminal."
              />
              <ProviderSummaryCard summary={providerSummary} />
              <SpotlightField>
                <ProviderDirectory providers={providers} />
              </SpotlightField>
            </DirectorySectionAnchor>
          </div>
        </div>

        {/* 05 · Bento highlights */}
        <div className="kunai-home-col">
          <section className="kunai-home-highlights kunai-home-section">
            <SectionHeading
              variant="home"
              animate={false}
              title="Everything stays one keystroke away."
            />
            {usageLine}
            <SpotlightField className="mt-10">
              <HomeBento highlights={homeHighlights} providers={providers} />
            </SpotlightField>
          </section>
        </div>

        {/* 06 · Detailed 3-step install by OS on alternating band */}
        <div className="kunai-band-surface">
          <div className="kunai-home-col">
            <HomePageInteractive />
          </div>
        </div>

        {/* 07–10 · Start here, Open source, Workshop, Final CTA */}
        <div className="kunai-home-col">
          <section className="kunai-home-start kunai-home-section">
            <SectionHeading
              variant="home"
              animate={false}
              title="Pick the guide that matches your next step."
            />
            <StartHereCards items={homeStartCards} />
          </section>

          <section className="kunai-home-open kunai-home-section">
            <SectionHeading
              variant="home"
              animate={false}
              title="Free, open, and kept alive in the open."
              description="Who makes it, how to help for free, and what sponsorship pays for."
            />
            <HomeOpenSource starCta={starCtaNode} />
          </section>

          <section className="kunai-home-workshop kunai-home-section">
            <SectionHeading
              variant="home"
              animate={false}
              title="More from the same workshop."
              description="Other tools KitsuneKode makes and maintains. Originals only, no forks."
            />
            <SpotlightField>
              <Suspense fallback={<WorkshopShowcaseFallback />}>
                <WorkshopShowcase />
              </Suspense>
            </SpotlightField>
          </section>

          <section className="kunai-home-final kunai-home-section">
            <div className="kunai-home-bottom-light" aria-hidden="true" />
            <div className="relative z-[1] mx-auto flex max-w-2xl flex-col items-center text-center">
              <KunaiFox className="kunai-final-fox" pose="go" size={96} animated />
              <h2 className="kunai-final-h2 mt-4 text-balance">
                One command to install. Nothing to sign up for.
              </h2>
              <p className="mt-4 max-w-lg text-sm leading-relaxed text-[var(--home-text-3)]">
                Kunai is MIT licensed, has no accounts or ads, and keeps your history on your
                machine.
              </p>

              <code className="kunai-install-dock__well mt-8 w-full max-w-[36rem]">
                <span className="kunai-install-dock__prompt" aria-hidden="true">
                  $
                </span>
                <span className="kunai-install-dock__cmd text-left">{CANONICAL_INSTALL}</span>
                <CopyButton
                  text={CANONICAL_INSTALL}
                  label="final-install"
                  className="kunai-install-dock__copy"
                />
              </code>

              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <Link className="kunai-button kunai-button-primary" href={homeHero.primaryCta.href}>
                  <span>{homeHero.primaryCta.label}</span>
                  <IconArrowRight className="ml-1.5 size-4" stroke={1.5} />
                </Link>
                {starCtaNode}
              </div>
            </div>
          </section>
        </div>

        {/* Floating bottom pill + non-boring morphing spring command drawer (lazy-loaded) */}
        <CommandDockIsland commands={allCommands} providers={providers} />
      </main>
    </HomeStageProvider>
  );
}
