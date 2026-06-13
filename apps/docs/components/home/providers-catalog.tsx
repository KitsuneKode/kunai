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
      <div className="relative z-0 flex flex-wrap gap-2 border-b border-[#f4d8e4]/5 pb-4">
        {providers.map((provider) => {
          const isActive = activeProviderId === provider.id;
          return (
            <button
              type="button"
              key={provider.id}
              onClick={() => setActiveProviderId(provider.id)}
              className={`relative cursor-pointer rounded-lg px-4 py-2 text-xs font-bold transition-colors duration-200 ${
                isActive
                  ? "text-white"
                  : "border border-[#f4d8e4]/5 bg-[#130f17] text-[#f4d8e4]/50 hover:border-[#f4d8e4]/20 hover:text-white"
              }`}
            >
              {provider.displayName}
              {provider.recommended ? (
                <Star className="ml-1 inline-block h-3 w-3 fill-current align-middle text-[#f09cb5]" />
              ) : null}

              {isActive ? (
                <motion.div
                  layoutId="activeProviderBg"
                  className="absolute inset-0 -z-10 rounded-lg border border-[#f09cb5]/30 bg-gradient-to-tr from-[#c86884] to-[#8c2a44] shadow-lg"
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
            className="provider-details-card rounded-2xl border border-[#f4d8e4]/10 bg-[#130f17]/60 p-6 shadow-xl backdrop-blur-md"
          >
            <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="m-0 flex items-center gap-2 font-serif text-2xl font-light text-white">
                  <span>{activeProvider.displayName}</span>
                  <span className="font-mono text-xs font-normal text-[#f4d8e4]/45">
                    ({activeProvider.domain})
                  </span>
                </h3>
                <p className="mt-1 font-mono text-[11px] text-[#f09cb5]">
                  Provider ID: &quot;{activeProvider.id}&quot;
                </p>
              </div>

              <div className="flex gap-2">
                <span
                  className={`chip-tag rounded-lg border px-2.5 py-1 font-mono text-[10px] font-bold tracking-wider ${
                    activeProvider.status === "active"
                      ? "border-[#8de4c2]/20 bg-[#8de4c2]/10 text-[#8de4c2]"
                      : "border-[#e4c180]/20 bg-[#e4c180]/10 text-[#e4c180]"
                  }`}
                >
                  status: {activeProvider.status}
                </span>

                {activeProvider.recommended ? (
                  <span className="chip-tag rounded-lg border border-[#8de4c2]/20 bg-[#8de4c2]/15 px-2.5 py-1 text-[10px] font-bold text-[#8de4c2]">
                    <Star className="mr-1 inline-block h-3.5 w-3.5 fill-current align-middle text-[#8de4c2]" />{" "}
                    Recommended
                  </span>
                ) : null}
              </div>
            </div>

            <p className="mt-3 font-sans text-sm leading-relaxed font-light text-zinc-300">
              {activeProvider.description}
            </p>

            <div className="mt-6 grid grid-cols-2 gap-6 border-t border-[#f4d8e4]/5 pt-5 text-xs">
              <div>
                <strong className="mb-2 block text-[10px] font-bold tracking-wider text-zinc-400 uppercase">
                  Supported Media Kinds
                </strong>
                <div className="flex flex-wrap gap-1.5">
                  {activeProvider.mediaKinds.map((kind) => (
                    <span
                      key={kind}
                      className="rounded-lg border border-[#f09cb5]/20 bg-[#f09cb5]/5 px-2.5 py-1 font-mono text-[10px] font-bold tracking-wider text-[#f09cb5] uppercase"
                    >
                      {kind}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <strong className="mb-2 block text-[10px] font-bold tracking-wider text-zinc-400 uppercase">
                  Scraper Capabilities
                </strong>
                <div className="flex flex-wrap gap-1.5">
                  {activeProvider.capabilities.map((cap) => (
                    <span
                      key={cap}
                      className="rounded-lg border border-[#f4d8e4]/5 bg-[#1e1824]/50 px-2 py-0.5 font-mono text-[10px] text-zinc-300"
                    >
                      {cap}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {activeProvider.notes && activeProvider.notes.length > 0 ? (
              <div className="mt-6 rounded-xl border border-[#f4d8e4]/5 bg-[#130f17]/40 p-4 text-xs leading-relaxed">
                <div className="mb-2 flex items-center gap-1.5 text-[#f09cb5]">
                  <Cpu className="h-3.5 w-3.5" />
                  <strong className="text-[11px] font-bold tracking-wider uppercase">
                    Scraper & Verification Details
                  </strong>
                </div>
                <ul className="list-disc space-y-1.5 pl-4 font-sans font-light text-[#f4d8e4]/70">
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
