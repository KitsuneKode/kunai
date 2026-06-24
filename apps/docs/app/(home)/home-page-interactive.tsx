"use client";

import type {
  HomeCliOption,
  HomeCommandMetadata,
  HomeProviderMetadata,
} from "@/components/home/types";
import { CopyButton } from "@/components/ui/copy-button";
import { SectionHeading } from "@/components/ui/section-heading";
import { homeHero } from "@/lib/home-content";
import { Check } from "lucide-react";
import dynamic from "next/dynamic";
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

type HomePageInteractiveProps = {
  readonly providers: readonly HomeProviderMetadata[];
  readonly commands: readonly HomeCommandMetadata[];
  readonly flags: readonly HomeCliOption[];
  readonly cliVersion: string;
  readonly runtimeBaseline: { readonly bun: string; readonly mpv: string };
};

export default function HomePageInteractive({
  providers,
  commands,
  flags,
  cliVersion,
  runtimeBaseline,
}: HomePageInteractiveProps) {
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

  const prereqCommand =
    activeOs === "linux"
      ? "sudo apt install mpv chafa"
      : activeOs === "macos"
        ? "brew install mpv chafa"
        : null;

  return (
    <>
      <div className="grain-overlay" aria-hidden="true" />
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
                      Install Bun and mpv, then ensure they are on your PATH.
                    </div>
                  )}
                </div>
              </div>

              <div className="install-step-card flex flex-col justify-between">
                <div>
                  <span className="kunai-step-label">Step 02</span>
                  <h3 className="kunai-type-title mt-2 mb-3 text-lg">Install Kunai shell</h3>
                </div>
                <code className="kunai-code-row">
                  <span>bun install -g @kitsunekode/kunai</span>
                  <CopyButton text="bun install -g @kitsunekode/kunai" label="global-install" />
                </code>
              </div>

              <div className="install-step-card flex flex-col justify-between">
                <div>
                  <span className="kunai-step-label">Step 03</span>
                  <h3 className="kunai-type-title mt-2 mb-3 text-lg">Initialize configuration</h3>
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
        <p className="kunai-eyebrow">Provider catalog</p>
        <h2 className="kunai-display-title">Active scrapers in the codebase.</h2>
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
    </>
  );
}
