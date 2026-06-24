"use client";

import { CopyButton } from "@/components/ui/copy-button";
import { SectionHeading } from "@/components/ui/section-heading";
import { Check } from "lucide-react";
import { useState } from "react";

export default function HomePageInteractive() {
  const [activeOs, setActiveOs] = useState<"linux" | "macos" | "windows">("linux");

  const prereqCommand =
    activeOs === "linux"
      ? "sudo apt install mpv chafa"
      : activeOs === "macos"
        ? "brew install mpv chafa"
        : null;

  return (
    <section id="install" className="kunai-home-install kunai-flow-section">
      <SectionHeading
        eyebrow="Install"
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
                  Kunai requires <code className="text-fd-foreground font-mono">mpv</code> for video
                  playback and <code className="text-fd-foreground font-mono">bun</code> as the CLI
                  runtime.
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
  );
}
