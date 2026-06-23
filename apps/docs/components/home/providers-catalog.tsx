"use client";

import { Cpu, Star } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { memo } from "react";

import type { HomeProviderMetadata } from "./types";

interface ProvidersCatalogProps {
  readonly providers: readonly HomeProviderMetadata[];
  readonly activeProviderId: string;
  readonly setActiveProviderId: (id: string) => void;
}

const ProvidersCatalog = memo(function ProvidersCatalog({
  providers,
  activeProviderId,
  setActiveProviderId,
}: ProvidersCatalogProps) {
  const activeProvider = providers.find((p) => p.id === activeProviderId) || providers[0];

  return (
    <div className="grid w-full gap-5">
      <div className="border-fd-border relative z-0 flex flex-wrap gap-2 border-b pb-4">
        {providers.map((provider) => {
          const isActive = activeProviderId === provider.id;
          return (
            <button
              type="button"
              key={provider.id}
              onClick={() => setActiveProviderId(provider.id)}
              className={`relative cursor-pointer rounded-lg px-4 py-2 text-xs font-bold transition-colors duration-[var(--dur-pop)] ease-[var(--ease-out)] ${
                isActive
                  ? "text-white"
                  : "border-fd-border bg-fd-card text-fd-muted-foreground hover:border-fd-primary/30 hover:text-fd-foreground border"
              }`}
            >
              {provider.displayName}
              {provider.recommended ? (
                <Star className="ml-1 inline-block h-3 w-3 fill-current align-middle text-[var(--kunai-accent)]" />
              ) : null}

              {isActive ? (
                <motion.div
                  layoutId="activeProviderBg"
                  className="absolute inset-0 -z-10 rounded-lg border border-[color-mix(in_oklab,var(--kunai-accent)_30%,transparent)] bg-gradient-to-tr from-[var(--kunai-accent-deep)] to-[#8c2a44] shadow-lg"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              ) : null}
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        {activeProvider ? (
          <motion.div
            key={activeProvider.id}
            initial={{ opacity: 0, y: 12, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.985 }}
            transition={{ type: "spring", duration: 0.35, bounce: 0.08 }}
            className="provider-details-card border-fd-border bg-fd-card/60 rounded-2xl border p-6 shadow-[var(--kunai-card-shadow)] backdrop-blur-md"
          >
            <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="text-fd-foreground m-0 flex items-center gap-2 font-serif text-2xl font-light">
                  <span>{activeProvider.displayName}</span>
                  <span className="text-fd-muted-foreground font-mono text-xs font-normal">
                    ({activeProvider.domain})
                  </span>
                </h3>
                <p className="mt-1 font-mono text-[11px] text-[var(--kunai-accent)]">
                  Provider ID: &quot;{activeProvider.id}&quot;
                </p>
              </div>

              <div className="flex gap-2">
                <span
                  className={`chip-tag rounded-lg border px-2.5 py-1 font-mono text-[10px] font-bold tracking-wider ${
                    activeProvider.status === "active"
                      ? "border-[color-mix(in_oklab,var(--kunai-ok)_25%,transparent)] bg-[color-mix(in_oklab,var(--kunai-ok)_12%,transparent)] text-[var(--kunai-ok)]"
                      : "border-[color-mix(in_oklab,var(--kunai-warning)_25%,transparent)] bg-[color-mix(in_oklab,var(--kunai-warning)_12%,transparent)] text-[var(--kunai-warning)]"
                  }`}
                >
                  status: {activeProvider.status}
                </span>

                {activeProvider.recommended ? (
                  <span className="chip-tag rounded-lg border border-[color-mix(in_oklab,var(--kunai-ok)_25%,transparent)] bg-[color-mix(in_oklab,var(--kunai-ok)_15%,transparent)] px-2.5 py-1 text-[10px] font-bold text-[var(--kunai-ok)]">
                    <Star className="mr-1 inline-block h-3.5 w-3.5 fill-current align-middle" />{" "}
                    Recommended
                  </span>
                ) : null}
              </div>
            </div>

            <p className="text-fd-muted-foreground mt-3 font-sans text-sm leading-relaxed font-light">
              {activeProvider.description}
            </p>

            <div className="border-fd-border mt-6 grid grid-cols-2 gap-6 border-t pt-5 text-xs">
              <div>
                <strong className="text-fd-muted-foreground mb-2 block text-[10px] font-bold tracking-wider uppercase">
                  Supported Media Kinds
                </strong>
                <div className="flex flex-wrap gap-1.5">
                  {activeProvider.mediaKinds.map((kind) => (
                    <span
                      key={kind}
                      className="rounded-lg border border-[color-mix(in_oklab,var(--kunai-accent)_20%,transparent)] bg-[color-mix(in_oklab,var(--kunai-accent)_6%,transparent)] px-2.5 py-1 font-mono text-[10px] font-bold tracking-wider text-[var(--kunai-accent)] uppercase"
                    >
                      {kind}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <strong className="text-fd-muted-foreground mb-2 block text-[10px] font-bold tracking-wider uppercase">
                  Scraper Capabilities
                </strong>
                <div className="flex flex-wrap gap-1.5">
                  {activeProvider.capabilities.map((cap) => (
                    <span
                      key={cap}
                      className="border-fd-border bg-fd-secondary/50 text-fd-muted-foreground rounded-lg border px-2 py-0.5 font-mono text-[10px]"
                    >
                      {cap}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {activeProvider.notes && activeProvider.notes.length > 0 ? (
              <div className="border-fd-border bg-fd-background/40 mt-6 rounded-xl border p-4 text-xs leading-relaxed">
                <div className="mb-2 flex items-center gap-1.5 text-[var(--kunai-accent)]">
                  <Cpu className="h-3.5 w-3.5" />
                  <strong className="text-[11px] font-bold tracking-wider uppercase">
                    Scraper & Verification Details
                  </strong>
                </div>
                <ul className="text-fd-muted-foreground list-disc space-y-1.5 pl-4 font-sans font-light">
                  {activeProvider.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
});

export { ProvidersCatalog };
