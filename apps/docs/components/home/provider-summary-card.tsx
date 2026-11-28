import type { ProviderSummary } from "@/lib/home-presenters";
import { IconArrowRight } from "@tabler/icons-react";
import Link from "next/link";

type ProviderSummaryCardProps = {
  readonly summary: ProviderSummary;
};

/** Slim server header above the interactive ProviderDirectory, preserving disclaimer truth. */
export function ProviderSummaryCard({ summary }: ProviderSummaryCardProps) {
  return (
    <div className="kunai-provider-header">
      <p className="m-0 max-w-2xl text-sm leading-relaxed text-[var(--home-text-4)]">
        <span className="font-mono text-[var(--home-text-2)] tabular-nums">
          {summary.count} registered adapters
        </span>{" "}
        — third-party and unaffiliated; streams resolve directly on your machine and may break or
        disappear.
      </p>
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <Link className="kunai-button kunai-button-quiet px-2 text-xs" href="/docs/users/providers">
          <span>Provider guide</span>
          <IconArrowRight className="ml-1 size-3.5" stroke={1.5} />
        </Link>
        <Link
          className="kunai-button kunai-button-quiet px-2 text-xs"
          href="/docs/users/providers#active-providers"
        >
          Full provider table
        </Link>
      </div>
    </div>
  );
}
