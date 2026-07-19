import { codeMetadata } from "@/lib/code-metadata";
import Link from "next/link";

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  candidate: "Candidate",
  production: "Production",
};

function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

function domainHref(domain: string): string {
  if (domain.startsWith("http://") || domain.startsWith("https://")) return domain;
  return `https://${domain}`;
}

export function ProviderTable() {
  return (
    <div className="not-prose overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 pr-4 font-medium">Provider</th>
            <th className="py-2 pr-4 font-medium">Domain</th>
            <th className="py-2 pr-4 font-medium">Media</th>
            <th className="py-2 pr-4 font-medium">Status</th>
            <th className="py-2 font-medium">Description</th>
          </tr>
        </thead>
        <tbody>
          {codeMetadata.providers.map((provider) => (
            <tr key={provider.id} className="border-fd-border/50 border-b align-top">
              <td className="py-3 pr-4 font-mono text-xs">
                <Link
                  href={`/docs/users/providers#${provider.id}`}
                  className="text-fd-primary font-medium underline-offset-4 hover:underline"
                >
                  {provider.displayName}
                </Link>
                {provider.recommended ? (
                  <span className="text-fd-primary ml-1 text-[10px]">recommended</span>
                ) : null}
                <div className="text-fd-muted-foreground mt-0.5">{provider.id}</div>
              </td>
              <td className="py-3 pr-4 font-mono text-xs">
                <a
                  href={domainHref(provider.domain)}
                  className="text-fd-foreground underline-offset-4 hover:underline"
                  rel="noreferrer"
                  target="_blank"
                >
                  {provider.domain}
                </a>
              </td>
              <td className="py-3 pr-4 font-mono text-xs">{provider.mediaKinds.join(", ")}</td>
              <td className="py-3 pr-4 font-mono text-xs">{statusLabel(provider.status)}</td>
              <td className="py-3 text-xs leading-relaxed">{provider.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
