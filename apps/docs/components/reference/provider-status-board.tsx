import { providerStatus, type ProviderSweepStatus } from "@/lib/provider-status";

const STATUS_STYLE: Record<ProviderSweepStatus, { label: string; className: string }> = {
  healthy: {
    label: "Healthy",
    className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  },
  degraded: {
    label: "Degraded",
    className: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  },
  blocked: {
    label: "Region-gated",
    className: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  },
  down: {
    label: "Maintenance",
    className: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  },
  dead: {
    label: "Unreachable",
    className: "bg-red-500/15 text-red-600 dark:text-red-400",
  },
};

const ORDER: Record<ProviderSweepStatus, number> = {
  healthy: 0,
  degraded: 1,
  blocked: 2,
  down: 3,
  dead: 4,
};

function checkedAgo(iso: string): string {
  const hours = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000));
  if (hours < 1) return "just now";
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function ProviderStatusBoard() {
  const rows = [...providerStatus.providers].sort(
    (a, b) => ORDER[a.effectiveStatus] - ORDER[b.effectiveStatus],
  );
  return (
    <div className="not-prose space-y-3">
      <p className="text-fd-muted-foreground text-xs">
        Measured {checkedAgo(providerStatus.generatedAt)} by the daily upstream sweep — a
        clean-network resolve of a known-good title per provider. Your own network may see a
        different picture; region-gated providers often work elsewhere.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 pr-4 font-medium">Provider</th>
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 pr-4 font-medium">Resolve</th>
              <th className="py-2 pr-4 font-medium">Lanes</th>
              <th className="py-2 font-medium">Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const style = STATUS_STYLE[row.effectiveStatus];
              return (
                <tr key={row.id} className="border-fd-border/50 border-b align-top">
                  <td className="py-3 pr-4 font-mono text-xs font-medium">{row.id}</td>
                  <td className="py-3 pr-4">
                    <span
                      className={`inline-block rounded-md px-2 py-0.5 font-mono text-xs ${style.className}`}
                    >
                      {style.label}
                    </span>
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs">
                    {row.resolveStatus}
                    {row.resolveMs !== null && row.resolveStatus === "resolved"
                      ? ` ${(row.resolveMs / 1000).toFixed(1)}s`
                      : ""}
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs">
                    {row.streams > 0
                      ? `${row.streams}${row.subtitleLanes ? ` · ${row.subtitleLanes} subs` : ""}${row.audioLanguages.length ? ` · ${row.audioLanguages.join("/")}` : ""}`
                      : "—"}
                  </td>
                  <td className="text-fd-muted-foreground py-3 text-xs leading-relaxed">
                    {row.note || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
