"use client";

import { GuideLinkGrid } from "@/components/home/guide-link-grid";
import type {
  HomeCliOption,
  HomeCommandMetadata,
  HomeProviderMetadata,
} from "@/components/home/types";
import { CopyButton } from "@/components/ui/copy-button";
import { SectionHeading } from "@/components/ui/section-heading";
import { homeFlow, homeHero, homeHighlights, homeProof, homeSections } from "@/lib/home-content";
import { ArrowRight, Check } from "lucide-react";
import { motion } from "motion/react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

const TerminalSimulator = dynamic(
  () => import("@/components/home/terminal-simulator").then((mod) => mod.TerminalSimulator),
  {
    ssr: false,
    loading: () => <div className="kunai-terminal-shell min-h-[420px] animate-pulse rounded-2xl" />,
  },
);

const CliCommandBuilder = dynamic(
  () => import("@/components/home/cli-command-builder").then((mod) => mod.CliCommandBuilder),
  { ssr: false },
);

const ProvidersCatalog = dynamic(
  () => import("@/components/home/providers-catalog").then((mod) => mod.ProvidersCatalog),
  {
    ssr: false,
    loading: () => <div className="bg-fd-card/40 min-h-[280px] animate-pulse rounded-2xl" />,
  },
);

type HomePageClientProps = {
  readonly providers: readonly HomeProviderMetadata[];
  readonly commands: readonly HomeCommandMetadata[];
  readonly flags: readonly HomeCliOption[];
  readonly commandCount: number;
  readonly providerCount: number;
  readonly cliVersion: string;
  readonly runtimeBaseline: { readonly bun: string; readonly mpv: string };
};

export default function HomePageClient({
  providers,
  commands,
  flags,
  commandCount,
  providerCount,
  cliVersion,
  runtimeBaseline,
}: HomePageClientProps) {
  const [activeProviderId, setActiveProviderId] = useState<string>(providers[0]?.id ?? "miruro");
  const [selectedFlags, setSelectedFlags] = useState<string[]>([]);
  const selectedFlagSet = useMemo(() => new Set(selectedFlags), [selectedFlags]);
  const [searchWord, setSearchWord] = useState("Dune");
  const [activeOs, setActiveOs] = useState<"linux" | "macos" | "windows">("linux");

  const toggleFlag = useCallback((flagLong: string) => {
    setSelectedFlags((prev) =>
      prev.includes(flagLong) ? prev.filter((f) => f !== flagLong) : [...prev, flagLong],
    );
  }, []);

  const buildCommandLine = useCallback(() => {
    let base = "kunai";
    const shortFlags: string[] = [];
    const longFlags: string[] = [];
    for (const flag of flags) {
      if (!selectedFlagSet.has(flag.long)) continue;
      if (flag.short) {
        shortFlags.push(flag.short.replace("-", ""));
      } else {
        longFlags.push(flag.long);
      }
    }

    if (shortFlags.length > 0) {
      base += ` -${shortFlags.join("")}`;
    }

    const hasSearch = selectedFlagSet.has("-S") || selectedFlagSet.has("--search");
    if (hasSearch) {
      base += ` -S "${searchWord}"`;
    }

    for (const flag of longFlags) {
      if (flag !== "--search") {
        base += ` ${flag}`;
      }
    }

    return base;
  }, [flags, searchWord, selectedFlagSet]);

  const proofItems = useMemo(() => {
    return homeProof.map((item) => {
      if (item.label !== "Runtime model") return item;
      return {
        ...item,
        detail: `Terminal-first. ${commandCount} shell commands across context groups. ${providerCount} provider modules. 1 SQLite history DB. Predictable daily use.`,
      };
    });
  }, [commandCount, providerCount]);

  const prereqCommand =
    activeOs === "linux"
      ? "sudo apt install mpv chafa"
      : activeOs === "macos"
        ? "brew install mpv chafa"
        : null;

  return (
    <main className="kunai-home relative mx-auto min-h-[100dvh] w-[min(1400px,calc(100vw-32px))] overflow-x-hidden py-8 max-md:w-[min(760px,calc(100vw-20px))]">
      <div className="grain-overlay" aria-hidden="true" />
      <div
        className="pointer-events-none absolute top-16 left-1/3 -z-10 h-[420px] w-[520px] animate-[pulse-glow_14s_infinite] rounded-full bg-gradient-to-tr from-[color-mix(in_oklab,var(--kunai-accent)_6%,transparent)] to-[color-mix(in_oklab,var(--kunai-ok)_4%,transparent)] blur-[130px]"
        aria-hidden="true"
      />
      <div className="ambient-glow-bottom" aria-hidden="true" />

      <section className="kunai-hero pb-18">
        <TerminalSimulator
          providers={providers}
          commands={commands}
          installCommands={homeHero.installCommands}
          primaryCtaHref={homeHero.primaryCta.href}
          primaryCtaLabel={homeHero.primaryCta.label}
          secondaryCtaHref={homeHero.secondaryCta.href}
          secondaryCtaLabel={homeHero.secondaryCta.label}
          cliVersion={cliVersion}
          runtimeBaseline={runtimeBaseline}
        />
      </section>

      <section id="install" className="kunai-flow-section">
        <SectionHeading
          eyebrow="Quick Setup"
          title="Get started in three steps."
          description="Kunai runs on any machine with Bun and mpv. Select your operating system to see the exact commands."
        />

        <div className="install-section kunai-surface-shell">
          <div className="kunai-surface-shell__inner p-6 md:p-8">
            <div
              className="border-fd-border mb-8 flex gap-3 border-b pb-6"
              role="tablist"
              aria-label="Operating system"
            >
              {(["linux", "macos", "windows"] as const).map((os) => (
                <button
                  type="button"
                  key={os}
                  role="tab"
                  aria-selected={activeOs === os}
                  onClick={() => setActiveOs(os)}
                  className={`os-tab-button text-[11px] tracking-wider uppercase ${
                    activeOs === os ? "active" : ""
                  }`}
                >
                  {os === "macos" ? "macOS" : os}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-6 max-lg:grid-cols-1">
              <div className="install-step-card flex flex-col justify-between">
                <div>
                  <div className="mb-4 flex items-center justify-between">
                    <span className="kunai-step-label">Step 01</span>
                    <span className="prereq-badge installed flex items-center gap-1.5">
                      <Check className="kunai-text-ok h-3 w-3 stroke-[3]" />
                      <span>Prerequisites</span>
                    </span>
                  </div>
                  <h3 className="kunai-type-title mt-2 mb-3 text-lg">Install dependencies</h3>
                  <p className="kunai-type-body mb-4 text-xs">
                    Kunai requires <code className="text-fd-foreground font-mono">mpv</code> for
                    video playback and <code className="text-fd-foreground font-mono">bun</code> as
                    the CLI runtime.
                  </p>
                </div>
                <div className="space-y-2">
                  {prereqCommand ? (
                    <code className="kunai-code-row">
                      <span>{prereqCommand}</span>
                      <CopyButton text={prereqCommand} label={`${activeOs}-prereq`} />
                    </code>
                  ) : (
                    <div className="kunai-callout-warn">
                      Install{" "}
                      <a
                        href="https://bun.sh"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-fd-foreground underline"
                      >
                        Bun for Windows
                      </a>{" "}
                      and{" "}
                      <a
                        href="https://mpv.io"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-fd-foreground underline"
                      >
                        mpv player
                      </a>
                      , then ensure they are on your PATH.
                    </div>
                  )}
                  <div className="kunai-step-meta mt-2 flex items-center gap-1.5">
                    <span>Verify with:</span>
                    <code className="kunai-surface-inset px-1 py-0.5">mpv --version</code>
                  </div>
                </div>
              </div>

              <div className="install-step-card flex flex-col justify-between">
                <div>
                  <div className="mb-4 flex items-center justify-between">
                    <span className="kunai-step-label">Step 02</span>
                    <span className="kunai-step-meta">CLI package</span>
                  </div>
                  <h3 className="kunai-type-title mt-2 mb-3 text-lg">Install Kunai shell</h3>
                  <p className="kunai-type-body mb-4 text-xs">
                    Install the package globally with Bun to get the unified command entry.
                  </p>
                </div>
                <code className="kunai-code-row">
                  <span>bun install -g @kitsunekode/kunai</span>
                  <CopyButton text="bun install -g @kitsunekode/kunai" label="global-install" />
                </code>
              </div>

              <div className="install-step-card flex flex-col justify-between">
                <div>
                  <div className="mb-4 flex items-center justify-between">
                    <span className="kunai-step-label">Step 03</span>
                    <span className="kunai-step-meta">First run</span>
                  </div>
                  <h3 className="kunai-type-title mt-2 mb-3 text-lg">Initialize configuration</h3>
                  <p className="kunai-type-body mb-4 text-xs">
                    Run setup to verify libraries, pick default folders, and configure Discord Rich
                    Presence.
                  </p>
                </div>
                <code className="kunai-code-row">
                  <span>kunai --setup</span>
                  <CopyButton text="kunai --setup" label="setup-cli" />
                </code>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="kunai-band relative">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
        >
          <p className="kunai-eyebrow">Provider catalog</p>
          <h2 className="kunai-display-title">Active scrapers in the codebase.</h2>
          <p className="kunai-type-body mt-4 max-w-none md:text-base">
            Kunai resolves streams through localized decryptors in{" "}
            <code className="kunai-surface-inset text-fd-primary px-1.5 py-0.5 font-mono text-xs">
              packages/providers
            </code>
            . Browserless parsing, synced from the production registry.
          </p>
        </motion.div>

        <ProvidersCatalog
          providers={providers}
          activeProviderId={activeProviderId}
          setActiveProviderId={setActiveProviderId}
        />
      </section>

      <section className="kunai-flow-section">
        <SectionHeading
          eyebrow="Interactive builder"
          title="Compose commands visually."
          description="Choose flags to build a command string, inspect option descriptions, and copy it into your shell."
        />
        <CliCommandBuilder
          flags={flags}
          selectedFlags={selectedFlags}
          toggleFlag={toggleFlag}
          searchWord={searchWord}
          setSearchWord={setSearchWord}
          buildCommandLine={buildCommandLine}
        />
      </section>

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
                  <span
                    className={`kunai-status-dot kunai-status-dot--${
                      step.state === "focus"
                        ? "focus"
                        : step.state === "ready"
                          ? "ready"
                          : step.state === "warn"
                            ? "warn"
                            : step.state === "danger"
                              ? "danger"
                              : "idle"
                    }`}
                    aria-hidden="true"
                  />
                </div>
                <h3 className="kunai-type-title mt-5 text-lg">{step.title}</h3>
                <p className="kunai-type-body mt-3 text-xs">{step.description}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="kunai-band">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
        >
          <p className="kunai-eyebrow">Experience promise</p>
          <h2 className="kunai-display-title">Designed for provider drift.</h2>
        </motion.div>
        <div className="kunai-highlight-grid">
          {homeHighlights.map((item) => (
            <article
              className="kunai-highlight premium-card-hover flex flex-col justify-between"
              key={item.label}
            >
              <div>
                <span className="kunai-step-label">{item.label}</span>
                <p className="kunai-type-body mt-4 text-sm">{item.detail}</p>
              </div>
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
            <article
              className="kunai-proof premium-card-hover flex flex-col justify-between"
              key={item.label}
            >
              <div>
                <span className="kunai-step-label text-[9px]">{item.label}</span>
                <p className="kunai-type-mono kunai-type-title mt-3 text-2xl md:text-3xl">
                  {item.value}
                </p>
                <p className="kunai-type-body mt-3 text-xs">{item.detail}</p>
              </div>
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
              <span>Debug a session</span>
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
