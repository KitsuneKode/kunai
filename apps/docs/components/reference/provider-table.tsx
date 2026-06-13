import { codeMetadata } from "../../lib/code-metadata";

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
                {provider.displayName}
                {provider.recommended ? (
                  <span className="text-fd-primary ml-1 text-[10px]">recommended</span>
                ) : null}
                <div className="text-fd-muted-foreground mt-0.5">{provider.id}</div>
              </td>
              <td className="py-3 pr-4 font-mono text-xs">{provider.domain}</td>
              <td className="py-3 pr-4 font-mono text-xs">{provider.mediaKinds.join(", ")}</td>
              <td className="py-3 pr-4 font-mono text-xs">{provider.status}</td>
              <td className="py-3 text-xs leading-relaxed">{provider.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
