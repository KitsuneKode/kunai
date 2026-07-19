import type { ProviderSummary } from "@/lib/home-presenters";
import { IconArrowRight } from "@tabler/icons-react";
import Link from "next/link";

type ProviderSummaryCardProps = {
  readonly summary: ProviderSummary;
};

export function ProviderSummaryCard({ summary }: ProviderSummaryCardProps) {
  const recommended =
    summary.recommended.length > 0 ? summary.recommended.join(", ") : "See the provider table";

  return (
    <div className="kunai-surface-shell">
      <div className="kunai-surface-shell__inner flex flex-col gap-6 p-6 md:flex-row md:items-center md:justify-between md:p-8">
        <div className="max-w-2xl">
          <p className="kunai-type-mono text-fd-foreground text-2xl font-medium tracking-tight">
            {summary.count} providers · {summary.activeCount} active
          </p>
          <p className="kunai-type-body text-fd-muted-foreground mt-3 text-sm leading-relaxed">
            Kunai resolves streams through direct HTTP adapters on your machine. Recommended
            defaults today: {recommended}.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link className="kunai-button kunai-button-primary" href="/docs/users/providers">
            <span>Provider guide</span>
            <IconArrowRight className="ml-1.5 size-4" stroke={1.5} />
          </Link>
          <Link
            className="kunai-button border-fd-border"
            href="/docs/users/providers#active-providers"
          >
            Full provider table
          </Link>
        </div>
      </div>
    </div>
  );
}
