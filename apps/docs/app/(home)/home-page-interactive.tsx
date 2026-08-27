"use client";

import { OtherInstallPaths } from "@/components/home/other-install-paths";
import { CopyButton } from "@/components/ui/copy-button";
import { SectionHeading } from "@/components/ui/section-heading";
import {
  CANONICAL_SETUP,
  FIRST_SEARCH,
  NATIVE_INSTALL_BY_OS,
  type NativeInstallOs,
} from "@/lib/install-commands";
import { useRef, useState } from "react";

const OS_ORDER = ["linux", "macos", "windows"] satisfies readonly NativeInstallOs[];

const OS_LABEL: Record<NativeInstallOs, string> = {
  linux: "Linux",
  macos: "macOS",
  windows: "Windows",
};

const PREREQ_COMMAND: Record<NativeInstallOs, string> = {
  linux: "sudo apt install mpv yt-dlp curl",
  macos: "brew install mpv yt-dlp curl",
  windows: "winget install mpv",
};

export default function HomePageInteractive() {
  const [activeOs, setActiveOs] = useState<NativeInstallOs>("linux");
  const tabRefs = useRef<Partial<Record<NativeInstallOs, HTMLButtonElement | null>>>({});

  const prereqCommand = PREREQ_COMMAND[activeOs];
  const installCommand = NATIVE_INSTALL_BY_OS[activeOs];

  /**
   * Arrow keys move between tabs, per the WAI-ARIA tabs pattern. Without this a
   * keyboard user has to Tab through every option to reach the last one, and
   * `role="tablist"` promises behaviour the widget does not deliver.
   */
  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    const index = OS_ORDER.indexOf(activeOs);
    const next = OS_ORDER[(index + delta + OS_ORDER.length) % OS_ORDER.length];
    if (!next) return;
    setActiveOs(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <section id="install" className="kunai-home-install kunai-flow-section">
      <SectionHeading
        eyebrow="Install"
        title="Get started in three steps."
        description="The preferred path is a self-contained binary — no Bun or Node required. Pick your OS for the exact bootstrap and mpv commands."
      />

      <div className="install-section kunai-surface-shell">
        <div className="kunai-surface-shell__inner p-6 md:p-8">
          <div
            className="os-tab-list border-fd-border mb-8 flex gap-3 border-b pb-6"
            role="tablist"
            aria-label="Operating system"
          >
            {OS_ORDER.map((os) => (
              <button
                type="button"
                key={os}
                id={`install-tab-${os}`}
                ref={(node) => {
                  tabRefs.current[os] = node;
                }}
                role="tab"
                aria-selected={activeOs === os}
                aria-controls="install-steps"
                tabIndex={activeOs === os ? 0 : -1}
                onClick={() => setActiveOs(os)}
                onKeyDown={handleTabKeyDown}
                className={`os-tab-button text-[11px] tracking-wider uppercase ${
                  activeOs === os ? "active" : ""
                }`}
              >
                {OS_LABEL[os]}
              </button>
            ))}
          </div>

          <div
            id="install-steps"
            role="tabpanel"
            aria-labelledby={`install-tab-${activeOs}`}
            className="grid grid-cols-3 gap-6 max-lg:grid-cols-1"
          >
            <div className="install-step-card flex flex-col justify-between">
              <div>
                <span className="kunai-step-label">Step 01</span>
                <h3 className="kunai-type-title mt-2 mb-3 text-lg">Install mpv</h3>
                <p className="kunai-type-body mb-4 text-xs">
                  Playback needs <code className="text-fd-foreground font-mono">mpv</code> on your{" "}
                  <code className="text-fd-foreground font-mono">PATH</code>. The binary install
                  embeds Bun, so Node and Bun are not needed separately.
                </p>
              </div>
              <code className="kunai-code-row">
                <span>{prereqCommand}</span>
                <CopyButton text={prereqCommand} label={`${activeOs}-prereq`} />
              </code>
            </div>

            <div className="install-step-card flex flex-col justify-between">
              <div>
                <span className="kunai-step-label">Step 02</span>
                <h3 className="kunai-type-title mt-2 mb-3 text-lg">Install the Kunai binary</h3>
                <p className="kunai-type-body mb-4 text-xs">
                  Downloads the release binary for {OS_LABEL[activeOs]} and puts{" "}
                  <code className="text-fd-foreground font-mono">kunai</code> on your PATH.
                </p>
              </div>
              <code className="kunai-code-row">
                <span>{installCommand}</span>
                <CopyButton text={installCommand} label={`${activeOs}-install`} />
              </code>
            </div>

            <div className="install-step-card flex flex-col justify-between">
              <div>
                <span className="kunai-step-label">Step 03</span>
                <h3 className="kunai-type-title mt-2 mb-3 text-lg">Set up, then search</h3>
                <p className="kunai-type-body mb-4 text-xs">
                  Setup writes your config once. After that, the second command opens the shell on a
                  real search.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <code className="kunai-code-row">
                  <span>{CANONICAL_SETUP}</span>
                  <CopyButton text={CANONICAL_SETUP} label="setup-cli" />
                </code>
                <code className="kunai-code-row">
                  <span>{FIRST_SEARCH}</span>
                  <CopyButton text={FIRST_SEARCH} label="first-search" />
                </code>
              </div>
            </div>
          </div>

          <OtherInstallPaths />
        </div>
      </div>
    </section>
  );
}
