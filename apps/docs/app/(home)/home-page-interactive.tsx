"use client";

import { SPRING_SNAP } from "@/components/home/home-stage-context";
import { OtherInstallPaths } from "@/components/home/other-install-paths";
import { CopyButton } from "@/components/ui/copy-button";
import { SectionHeading } from "@/components/ui/section-heading";
import {
  CANONICAL_SETUP,
  FIRST_SEARCH,
  NATIVE_INSTALL_BY_OS,
  type NativeInstallOs,
} from "@/lib/install-commands";
import { IconChevronDown } from "@tabler/icons-react";
import { domMax, LazyMotion, m, useReducedMotion } from "motion/react";
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
  const reduced = useReducedMotion();

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
    <LazyMotion features={domMax}>
      <section id="install" className="kunai-home-install kunai-home-section">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <SectionHeading
            variant="home"
            animate={false}
            className="m-0"
            title="Install in three steps."
            description="Self-contained release binary — no Bun or Node required. Pick your OS for the exact mpv and bootstrap commands."
          />

          <div className="os-tab-list" role="tablist" aria-label="Operating system">
            {OS_ORDER.map((os) => {
              const active = activeOs === os;
              return (
                <button
                  type="button"
                  key={os}
                  id={`install-tab-${os}`}
                  ref={(node) => {
                    tabRefs.current[os] = node;
                  }}
                  role="tab"
                  aria-selected={active}
                  aria-controls="install-steps"
                  tabIndex={active ? 0 : -1}
                  onClick={() => setActiveOs(os)}
                  onKeyDown={handleTabKeyDown}
                  className={`os-tab-button${active ? " active" : ""}`}
                >
                  {active ? (
                    <m.span
                      layoutId="install-os-pill"
                      className="os-tab-button__bg"
                      transition={reduced ? { duration: 0 } : SPRING_SNAP}
                    />
                  ) : null}
                  <span className="relative z-[1]">{OS_LABEL[os]}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div
          key={activeOs}
          id="install-steps"
          role="tabpanel"
          aria-labelledby={`install-tab-${activeOs}`}
          className="kunai-tab-panel kunai-install-columns mt-10"
        >
          <div className="kunai-install-col">
            <div>
              <span className="kunai-install-col__num tabular-nums">01</span>
              <h3 className="kunai-install-col__title">Install mpv</h3>
              <p className="kunai-install-col__body">
                Playback needs <code className="font-mono text-[var(--home-text-1)]">mpv</code> on
                your <code className="font-mono text-[var(--home-text-1)]">PATH</code>. The binary
                embeds Bun, so Node and Bun are not needed separately.
              </p>
            </div>
            <div className="kunai-install-col__cmd">
              <code className="kunai-code-row">
                <span>{prereqCommand}</span>
                <CopyButton text={prereqCommand} label={`${activeOs}-prereq`} />
              </code>
            </div>
          </div>

          <div className="kunai-install-col">
            <div>
              <span className="kunai-install-col__num tabular-nums">02</span>
              <h3 className="kunai-install-col__title">Install the Kunai binary</h3>
              <p className="kunai-install-col__body">
                Downloads the release binary for {OS_LABEL[activeOs]} and puts{" "}
                <code className="font-mono text-[var(--home-text-1)]">kunai</code> on your PATH.
              </p>
            </div>
            <div className="kunai-install-col__cmd">
              <code className="kunai-code-row">
                <span>{installCommand}</span>
                <CopyButton text={installCommand} label={`${activeOs}-install`} />
              </code>
            </div>
          </div>

          <div className="kunai-install-col">
            <div>
              <span className="kunai-install-col__num tabular-nums">03</span>
              <h3 className="kunai-install-col__title">Set up, then search</h3>
              <p className="kunai-install-col__body">
                Setup writes your config once. After that, the second command opens the shell on a
                real search.
              </p>
            </div>
            <div className="kunai-install-col__cmd flex flex-col gap-2">
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

        <details className="kunai-disclosure kunai-other-disclosure mt-8">
          <summary className="kunai-other-disclosure__summary">
            <span>Other install paths (Bun, npm, prebuilt binaries, source)</span>
            <IconChevronDown className="kunai-other-disclosure__chev size-4" stroke={1.6} />
          </summary>
          <OtherInstallPaths />
        </details>
      </section>
    </LazyMotion>
  );
}
