"use client";

import { ArrowRight, Check } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { CliCommandBuilder } from "../../components/home/cli-command-builder";
import { ProvidersCatalog } from "../../components/home/providers-catalog";
import { TerminalSimulator } from "../../components/home/terminal-simulator";
import type { HomeCliOption, HomeProviderMetadata } from "../../components/home/types";
import metadata from "../../lib/generated-metadata.json";
import {
  homeFlow,
  homeHero,
  homeHighlights,
  homeProof,
  homeSections,
} from "../../lib/home-content";

export default function HomePage() {
  const providers = (metadata.providers || []) as readonly HomeProviderMetadata[];
  const commands = metadata.commands || [];
  const flags = useMemo(() => (metadata.cliOptions || []) as readonly HomeCliOption[], []);

  // Provider Tab State
  const [activeProviderId, setActiveProviderId] = useState<string>(providers[0]?.id || "miruro");

  // Flag Builder State
  const [selectedFlags, setSelectedFlags] = useState<string[]>([]);
  const selectedFlagSet = useMemo(() => new Set(selectedFlags), [selectedFlags]);
  const [searchWord, setSearchWord] = useState("Dune");

  // Copied state
  const [copiedText, setCopiedText] = useState<string | null>(null);

  // OS Selector state for installation section
  const [activeOs, setActiveOs] = useState<"linux" | "macos" | "windows">("linux");

  const toggleFlag = useCallback((flagLong: string) => {
    setSelectedFlags((prev) =>
      prev.includes(flagLong) ? prev.filter((f) => f !== flagLong) : [...prev, flagLong],
    );
  }, []);

  const copyToClipboard = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => {
      setCopiedText(null);
    }, 1800);
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

    longFlags.forEach((flag) => {
      if (flag !== "--search") {
        base += ` ${flag}`;
      }
    });

    return base;
  }, [flags, searchWord, selectedFlagSet]);

  const proofItems = useMemo(() => {
    return homeProof.map((item) => {
      if (item.label !== "Runtime model") return item;
      return {
        ...item,
        detail: `Terminal-first. ${metadata.commandCount} shell commands across context groups. ${metadata.providerIds.length} provider modules. 1 SQLite history DB. Predictable daily use.`,
      };
    });
  }, []);

  return (
    <main className="kunai-home mx-auto min-h-[100dvh] w-[min(1400px,calc(100vw-32px))] overflow-x-hidden py-8 max-md:w-[min(760px,calc(100vw-20px))]">
      {/* Film Grain Texture for editorial atmosphere */}
      <div className="grain-overlay" />

      {/* Background drifting ambient mesh glows */}
      <div className="pointer-events-none absolute top-10 left-1/4 -z-10 h-[350px] w-[500px] animate-[pulse-glow_12s_infinite] rounded-full bg-gradient-to-tr from-[#f09cb5]/5 to-[#8de4c2]/5 blur-[120px]" />
      <div className="pointer-events-none absolute top-1/3 right-1/4 -z-10 h-[400px] w-[400px] animate-[pulse-glow_16s_infinite] rounded-full bg-gradient-to-tr from-[#8de4c2]/5 to-[#c86884]/5 blur-[140px]" />
      <div className="ambient-glow-bottom" />

      {/* 1. Hero & Interactive Terminal Simulator */}
      <section className="kunai-hero pb-18">
        <TerminalSimulator
          providers={providers}
          commands={commands}
          installCommands={homeHero.installCommands}
          primaryCtaHref={homeHero.primaryCta.href}
          primaryCtaLabel={homeHero.primaryCta.label}
          secondaryCtaHref={homeHero.secondaryCta.href}
          secondaryCtaLabel={homeHero.secondaryCta.label}
          copyToClipboard={copyToClipboard}
          copiedText={copiedText}
        />
      </section>

      {/* Prerequisites & Installation Section */}
      <section id="install" className="kunai-flow-section">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="kunai-section-head"
        >
          <p className="kunai-eyebrow">Quick Setup</p>
          <h2 className="bg-gradient-to-br from-white to-[#f4d8e4] bg-clip-text font-serif leading-[1.1] text-transparent">
            Get started in 3 simple steps.
          </h2>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed font-light text-zinc-400 md:text-base">
            Kunai runs on any machine with Bun and mpv. Select your operating system to see the
            exact commands.
          </p>
        </motion.div>

        <div className="install-section">
          {/* OS Selector Tabs */}
          <div className="mb-8 flex gap-3 border-b border-[#f4d8e4]/5 pb-6">
            {(["linux", "macos", "windows"] as const).map((os) => (
              <button
                type="button"
                key={os}
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
            {/* Step 1: Prerequisites */}
            <div className="install-step-card flex flex-col justify-between">
              <div>
                <div className="mb-4 flex items-center justify-between">
                  <span className="font-mono text-[10px] font-bold tracking-wider text-[#f09cb5] uppercase">
                    Step 01
                  </span>
                  <span className="prereq-badge installed flex items-center gap-1.5">
                    <Check className="h-3 w-3 stroke-[3] text-[#8de4c2]" />
                    <span>Prerequisites</span>
                  </span>
                </div>
                <h3 className="mt-2 mb-3 font-serif text-lg font-light text-white">
                  Install Dependencies
                </h3>
                <p className="mb-4 text-xs leading-relaxed font-light text-zinc-400">
                  Kunai requires <code className="font-mono text-zinc-200">mpv</code> for video
                  playback and <code className="font-mono text-zinc-200">bun</code> as the CLI
                  runtime.
                </p>
              </div>
              <div className="space-y-2">
                {activeOs === "linux" && (
                  <code className="flex items-center justify-between rounded-lg border border-[#f4d8e4]/5 bg-[#130f17]/80 px-3 py-1.5 font-mono text-[10px] text-zinc-300">
                    <span>sudo apt install mpv chafa</span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard("sudo apt install mpv chafa", "apt-install")}
                      className="copy-btn shrink-0 cursor-pointer rounded border border-[#f4d8e4]/10 bg-[#1e1824]/60 px-2 py-0.5 text-[9px] text-[#f09cb5] transition-colors hover:text-white"
                    >
                      {copiedText === "apt-install" ? "Copied" : "Copy"}
                    </button>
                  </code>
                )}
                {activeOs === "macos" && (
                  <code className="flex items-center justify-between rounded-lg border border-[#f4d8e4]/5 bg-[#130f17]/80 px-3 py-1.5 font-mono text-[10px] text-zinc-300">
                    <span>brew install mpv chafa</span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard("brew install mpv chafa", "brew-install")}
                      className="copy-btn shrink-0 cursor-pointer rounded border border-[#f4d8e4]/10 bg-[#1e1824]/60 px-2 py-0.5 text-[9px] text-[#f09cb5] transition-colors hover:text-white"
                    >
                      {copiedText === "brew-install" ? "Copied" : "Copy"}
                    </button>
                  </code>
                )}
                {activeOs === "windows" && (
                  <div className="rounded-lg border border-[#e4c180]/10 bg-[#e4c180]/5 p-2.5 text-[10px] font-light text-[#e4c180]">
                    Install{" "}
                    <a
                      href="https://bun.sh"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-white"
                    >
                      Bun for Windows
                    </a>{" "}
                    and{" "}
                    <a
                      href="https://mpv.io"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-white"
                    >
                      mpv player
                    </a>
                    , then ensure they are in your path variables.
                  </div>
                )}
                <div className="mt-2 flex items-center gap-1.5 font-mono text-[9px] text-[#f4d8e4]/40">
                  <span>Verify with:</span>
                  <code className="rounded bg-[#130f17] px-1 py-0.5">mpv --version</code>
                </div>
              </div>
            </div>

            {/* Step 2: Global Install */}
            <div className="install-step-card flex flex-col justify-between">
              <div>
                <div className="mb-4 flex items-center justify-between">
                  <span className="font-mono text-[10px] font-bold tracking-wider text-[#f09cb5] uppercase">
                    Step 02
                  </span>
                  <span className="font-mono text-[9px] text-[#f4d8e4]/40">CLI Package</span>
                </div>
                <h3 className="mt-2 mb-3 font-serif text-lg font-light text-white">
                  Install Kunai Shell
                </h3>
                <p className="mb-4 text-xs leading-relaxed font-light text-zinc-400">
                  Install the package globally using Bun's package manager. This gives you the
                  unified command entry.
                </p>
              </div>
              <div className="space-y-2">
                <code className="flex items-center justify-between rounded-lg border border-[#f4d8e4]/5 bg-[#130f17]/80 px-3 py-1.5 font-mono text-[10px] text-zinc-300">
                  <span>bun install -g @kitsunekode/kunai</span>
                  <button
                    type="button"
                    onClick={() =>
                      copyToClipboard("bun install -g @kitsunekode/kunai", "global-install")
                    }
                    className="copy-btn shrink-0 cursor-pointer rounded border border-[#f4d8e4]/10 bg-[#1e1824]/60 px-2 py-0.5 text-[9px] text-[#f09cb5] transition-colors hover:text-white"
                  >
                    {copiedText === "global-install" ? "Copied" : "Copy"}
                  </button>
                </code>
                <div className="font-mono text-[9px] text-[#f4d8e4]/40">
                  Prefer Bun for global CLI packages as it executes sub-second.
                </div>
              </div>
            </div>

            {/* Step 3: Setup configuration */}
            <div className="install-step-card flex flex-col justify-between">
              <div>
                <div className="mb-4 flex items-center justify-between">
                  <span className="font-mono text-[10px] font-bold tracking-wider text-[#f09cb5] uppercase">
                    Step 03
                  </span>
                  <span className="font-mono text-[9px] text-[#f4d8e4]/40">First Run</span>
                </div>
                <h3 className="mt-2 mb-3 font-serif text-lg font-light text-white">
                  Initialize Configuration
                </h3>
                <p className="mb-4 text-xs leading-relaxed font-light text-zinc-400">
                  Initialize settings, select default folders, verify system libraries, and setup
                  Discord Rich Presence.
                </p>
              </div>
              <div className="space-y-2">
                <code className="flex items-center justify-between rounded-lg border border-[#f4d8e4]/5 bg-[#130f17]/80 px-3 py-1.5 font-mono text-[10px] text-zinc-300">
                  <span>kunai --setup</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard("kunai --setup", "setup-cli")}
                    className="copy-btn shrink-0 cursor-pointer rounded border border-[#f4d8e4]/10 bg-[#1e1824]/60 px-2 py-0.5 text-[9px] text-[#f09cb5] transition-colors hover:text-white"
                  >
                    {copiedText === "setup-cli" ? "Copied" : "Copy"}
                  </button>
                </code>
                <div className="font-mono text-[9px] text-[#f4d8e4]/40">
                  This writes atomic JSON to{" "}
                  <code className="rounded bg-[#130f17] px-1 py-0.5">~/.config/kunai</code>.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Real Active Providers Catalog */}
      <section className="kunai-band relative">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
        >
          <p className="kunai-eyebrow">Scrapers Catalog</p>
          <h2 className="bg-gradient-to-br from-white to-[#f4d8e4] bg-clip-text font-serif leading-[1.1] text-transparent">
            Active Scrapers local in codebase.
          </h2>
          <p className="mt-4 font-sans text-sm leading-relaxed font-light text-zinc-400 md:text-base">
            Kunai resolves source files directly using custom, localized decryptors located in{" "}
            <code className="rounded border border-[#f4d8e4]/5 bg-[#1e1824]/60 px-1.5 py-0.5 font-mono text-[#f09cb5]">
              packages/providers
            </code>
            . Fully sandboxed and browserless parsing engine.
          </p>
        </motion.div>

        <ProvidersCatalog
          providers={providers}
          activeProviderId={activeProviderId}
          setActiveProviderId={setActiveProviderId}
        />
      </section>

      {/* 3. Interactive CLI Command Builder */}
      <section className="kunai-flow-section">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="kunai-section-head"
        >
          <p className="kunai-eyebrow">Interactive Builder</p>
          <h2 className="bg-gradient-to-br from-white to-[#f4d8e4] bg-clip-text font-serif leading-[1.1] text-transparent">
            Compose commands visually.
          </h2>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed font-light text-zinc-400 md:text-base">
            Construct argument scripts dynamically. Choose flags to compile the command line string,
            inspect option descriptions, and execute it locally in your shell.
          </p>
        </motion.div>

        <CliCommandBuilder
          flags={flags}
          selectedFlags={selectedFlags}
          toggleFlag={toggleFlag}
          searchWord={searchWord}
          setSearchWord={setSearchWord}
          buildCommandLine={buildCommandLine}
          copyToClipboard={copyToClipboard}
          copiedText={copiedText}
        />
      </section>

      {/* 4. Playback Path Flow */}
      <section className="kunai-flow-section">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="kunai-section-head"
        >
          <p className="kunai-eyebrow">Playback path</p>
          <h2 className="bg-gradient-to-br from-white to-[#f4d8e4] bg-clip-text font-serif leading-[1.1] text-transparent">
            One readable path from intent to recovery.
          </h2>
        </motion.div>
        <div className="kunai-flow">
          {homeFlow.map((step, index) => (
            <article
              className={`kunai-flow-card premium-card-hover kunai-state-${step.state} flex flex-col justify-between rounded-2xl border border-[#f4d8e4]/5 bg-[#130f17]/40 p-5 backdrop-blur-md`}
              key={step.title}
              style={{ animation: "none", animationDelay: `${index * 60}ms` }}
            >
              <div>
                <div className="flex items-start justify-between">
                  <span className="font-mono text-[10px] text-[#f4d8e4]/30">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span
                    className={`h-2.5 w-2.5 animate-pulse rounded-full shadow-sm ${
                      step.state === "focus"
                        ? "bg-[#f09cb5] shadow-[#f09cb5]/30"
                        : step.state === "ready"
                          ? "bg-[#8de4c2] shadow-[#8de4c2]/30"
                          : step.state === "warn"
                            ? "bg-[#e4c180] shadow-[#e4c180]/30"
                            : step.state === "danger"
                              ? "bg-[#ff8084] shadow-[#ff8084]/30"
                              : "bg-[#f4d8e4]/20"
                    }`}
                  ></span>
                </div>
                <h3 className="mt-5 font-serif text-lg leading-snug font-light text-white">
                  {step.title}
                </h3>
                <p className="mt-3 font-sans text-xs leading-relaxed font-light text-zinc-400">
                  {step.description}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* 5. Experience Promises */}
      <section className="kunai-band">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
        >
          <p className="kunai-eyebrow">Experience promise</p>
          <h2 className="bg-gradient-to-br from-white to-[#f4d8e4] bg-clip-text font-serif leading-[1.1] text-transparent">
            Designed for provider drift.
          </h2>
        </motion.div>
        <div className="kunai-highlight-grid">
          {homeHighlights.map((item) => (
            <article
              className="kunai-highlight premium-card-hover flex flex-col justify-between rounded-2xl border border-[#f4d8e4]/5 bg-[#130f17]/40 p-5 backdrop-blur-md"
              key={item.label}
              style={{ animation: "none" }}
            >
              <div>
                <span className="font-mono text-[10px] font-bold tracking-wider text-[#f09cb5] uppercase">
                  {item.label}
                </span>
                <p className="margin-top-5 mt-4 font-sans text-sm leading-relaxed font-light text-zinc-300">
                  {item.detail}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* 6. Docs Map */}
      <section className="kunai-docs-section">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="kunai-section-head"
        >
          <p className="kunai-eyebrow">Guides map</p>
          <h2 className="bg-gradient-to-br from-white to-[#f4d8e4] bg-clip-text font-serif leading-[1.1] text-transparent">
            Select guide by specific operational role.
          </h2>
        </motion.div>
        <div className="grid gap-6">
          {homeSections.map((section) => (
            <section
              className="kunai-doc-row flex flex-col gap-6 rounded-2xl border border-[#f4d8e4]/5 bg-[#130f17]/40 p-6 backdrop-blur-md lg:grid lg:grid-cols-[0.4fr_1fr]"
              key={section.title}
              style={{ animation: "none" }}
            >
              <div className="flex flex-col justify-between py-2">
                <div>
                  <p className="kunai-eyebrow text-[10px]">{section.eyebrow}</p>
                  <h3 className="mt-2 font-serif text-xl leading-snug font-light text-white">
                    {section.title}
                  </h3>
                  <p className="mt-2 font-sans text-xs leading-relaxed font-light text-zinc-400">
                    {section.description}
                  </p>
                </div>
              </div>
              <div className="kunai-doc-links">
                {section.items.map((item) => (
                  <Link
                    className="kunai-doc-card premium-card-hover group flex flex-col justify-between rounded-xl border border-[#f4d8e4]/5 bg-[#0b070e]/80 p-5"
                    href={item.href}
                    key={item.href}
                  >
                    <div>
                      <span className="font-serif text-base font-light text-white transition-colors duration-200 group-hover:text-[#f09cb5]">
                        {item.title}
                      </span>
                      <small className="mt-2 block font-sans text-xs leading-relaxed font-light text-zinc-400">
                        {item.description}
                      </small>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>

      {/* 7. Proof Grid */}
      <section className="kunai-proof-section">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="kunai-section-head"
        >
          <p className="kunai-eyebrow">Reliability posture</p>
          <h2 className="bg-gradient-to-br from-white to-[#f4d8e4] bg-clip-text font-serif leading-[1.1] text-transparent">
            Insightful metadata telemetry.
          </h2>
        </motion.div>
        <div className="kunai-proof-grid grid grid-cols-3 gap-6 max-lg:grid-cols-1">
          {proofItems.map((item) => (
            <article
              className="kunai-proof premium-card-hover flex flex-col justify-between rounded-2xl border border-[#f4d8e4]/5 bg-[#130f17]/40 p-6 backdrop-blur-md"
              key={item.label}
              style={{ animation: "none" }}
            >
              <div>
                <span className="font-mono text-[9px] font-bold tracking-wider text-[#f09cb5] uppercase">
                  {item.label}
                </span>
                <strong className="mt-4 block font-serif text-3xl font-light tracking-tight text-white">
                  {item.value}
                </strong>
                <p className="mt-3 font-sans text-xs leading-relaxed font-light text-zinc-400">
                  {item.detail}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* 8. Final Call to Action */}
      <section className="kunai-final flex items-center justify-between gap-6 rounded-2xl border border-[#f4d8e4]/10 bg-gradient-to-tr from-[#130f17] to-[#1e1824] p-8 max-md:flex-col">
        <div>
          <p className="kunai-eyebrow">Start here</p>
          <h2 className="mt-2 max-w-xl bg-gradient-to-br from-white to-[#f4d8e4] bg-clip-text font-serif text-3xl leading-[1.1] font-light text-transparent md:text-4xl">
            Install once. Keep stream pipeline diagnostic-rich.
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
            className="kunai-button border-[#f4d8e4]/15 hover:border-[#f09cb5]"
            href="/docs/users/diagnostics-and-reporting"
          >
            <span>Debug a session</span>
          </Link>
        </div>
      </section>
    </main>
  );
}
