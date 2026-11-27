import { codeMetadata } from "@/lib/code-metadata";
import Link from "next/link";

function providerName(id: string): string {
  return codeMetadata.providers.find((provider) => provider.id === id)?.displayName ?? id;
}

function ProviderOrder({ ids }: { readonly ids: readonly string[] }) {
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
      {ids.map((id, index) => (
        <span key={id} className="flex items-center gap-1.5">
          {index > 0 && <span className="text-fd-muted-foreground">→</span>}
          <Link
            href={`/docs/users/providers#${id}`}
            className="text-fd-primary font-medium underline-offset-4 hover:underline"
          >
            {providerName(id)}
          </Link>
          <span className="text-fd-muted-foreground font-mono text-[11px]">{id}</span>
        </span>
      ))}
    </span>
  );
}

export function ProviderOrderTable() {
  const rows = [
    { lane: "Movies / series", metadata: codeMetadata.providerDefaults.series },
    { lane: "Anime", metadata: codeMetadata.providerDefaults.anime },
    { lane: "YouTube", metadata: codeMetadata.providerDefaults.youtube },
  ];

  return (
    <div className="not-prose overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 pr-4 font-medium">Lane</th>
            <th className="py-2 pr-4 font-medium">Default</th>
            <th className="py-2 font-medium">Automatic order</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.lane} className="border-fd-border/50 border-b align-top">
              <td className="py-3 pr-4 font-medium whitespace-nowrap">{row.lane}</td>
              <td className="py-3 pr-4">
                <ProviderOrder ids={[row.metadata.defaultProvider]} />
              </td>
              <td className="py-3">
                <ProviderOrder ids={row.metadata.order} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-fd-muted-foreground mt-2 text-xs">
        Generated from config defaults revision {codeMetadata.providerDefaults.revision} in Kunai{" "}
        {codeMetadata.cliVersion}.
      </p>
    </div>
  );
}
