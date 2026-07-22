"use client";

import { CopyButton } from "@/components/ui/copy-button";
import { SectionHeading } from "@/components/ui/section-heading";
import {
  CANONICAL_SETUP,
  NATIVE_INSTALL_BY_OS,
  type NativeInstallOs,
} from "@/lib/install-commands";
import { IconCheck } from "@tabler/icons-react";
import { useState } from "react";

export default function HomePageInteractive() {
  const [activeOs, setActiveOs] = useState<NativeInstallOs>("linux");

  const prereqCommand =
    activeOs === "linux"
      ? "sudo apt install mpv chafa"
      : activeOs === "macos"
        ? "brew install mpv chafa"
        : "winget install mpv";

  const installCommand = NATIVE_INSTALL_BY_OS[activeOs];

  return (
    <section id="install" className="kunai-home-install kunai-flow-section">
      <SectionHeading
        eyebrow="Install"
        title="Get started in three steps."
        description="Preferred path is a self-contained binary (no Bun or Node required). Select your OS for the exact bootstrap and mpv commands."
      />

      <div className="install-section kunai-surface-shell">
        <div className="kunai-surface-shell__inner p-6 md:p-8">
          <div
            className="border-fd-border mb-8 flex gap-3 border-b pb-6"
            role="tablist"
            aria-label="Operating system"
          >
            {(["linux", "macos", "windows"] satisfies readonly NativeInstallOs[]).map((os) => (
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
                    <IconCheck className="kunai-text-ok size-3" stroke={2} />
                    <span>Prerequisites</span>
                  </span>
                </div>
                <h3 className="kunai-type-title mt-2 mb-3 text-lg">Install dependencies</h3>
                <p className="kunai-type-body mb-4 text-xs">
                  Playback needs <code className="text-fd-foreground font-mono">mpv</code> on your{" "}
                  <code className="text-fd-foreground font-mono">PATH</code>. The binary install
                  embeds Bun — you do not need Node or Bun separately.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <code className="kunai-code-row">
                  <span>{prereqCommand}</span>
                  <CopyButton text={prereqCommand} label={`${activeOs}-prereq`} />
                </code>
              </div>
            </div>

            <div className="install-step-card flex flex-col justify-between">
              <div>
                <span className="kunai-step-label">Step 02</span>
                <h3 className="kunai-type-title mt-2 mb-3 text-lg">Install Kunai shell</h3>
              </div>
              <code className="kunai-code-row">
                <span>{installCommand}</span>
                <CopyButton text={installCommand} label={`${activeOs}-install`} />
              </code>
            </div>

            <div className="install-step-card flex flex-col justify-between">
              <div>
                <span className="kunai-step-label">Step 03</span>
                <h3 className="kunai-type-title mt-2 mb-3 text-lg">Initialize configuration</h3>
              </div>
              <code className="kunai-code-row">
                <span>{CANONICAL_SETUP}</span>
                <CopyButton text={CANONICAL_SETUP} label="setup-cli" />
              </code>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
