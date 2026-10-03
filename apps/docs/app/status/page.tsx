import { ProviderStatusPanel } from "@/components/status/provider-status-panel";
import { buildPageMetadata } from "@/lib/page-metadata";
import { STATUS_REVALIDATE_SECONDS } from "@/lib/provider-status-live";
import type { Metadata } from "next";

// The data is fetched live and cached for this long; the page regenerates on the same
// beat, so a new daily result or a posted notice shows within minutes with no deploy.
export const revalidate = STATUS_REVALIDATE_SECONDS;

export const metadata: Metadata = buildPageMetadata({
  title: "Kunai provider status: which providers are working today",
  absoluteTitle: true,
  description:
    "A daily check of every Kunai provider from a clean network: which resolve right now, which are region-gated or down, and how each has done over the last 30 days.",
  socialDescription:
    "Which Kunai providers resolve today, checked daily from a clean network, with 30 days of history.",
  path: "/status",
});

export default function StatusPage() {
  return (
    <main className="kunai-home relative mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-14 md:px-10">
      <header className="border-border flex flex-col gap-4 border-b pb-8">
        <p className="text-muted-foreground m-0 text-xs font-medium tracking-[0.16em] uppercase">
          Trust surface
        </p>
        <h1 className="kunai-display-title max-w-none text-4xl md:text-5xl">Provider status</h1>
        <p className="text-muted-foreground max-w-2xl text-base leading-7 text-pretty">
          Which providers Kunai can resolve a stream from today, checked once a day from a clean
          network, with the last thirty days of each.
        </p>
      </header>
      <ProviderStatusPanel />
    </main>
  );
}
