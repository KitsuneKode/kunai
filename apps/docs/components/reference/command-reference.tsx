import { CommandReferenceFilter } from "@/components/reference/command-reference-filter";
import { codeMetadata } from "@/lib/code-metadata";

/**
 * Server component: the command table is rendered in RSC so the full
 * generated-metadata.json never ships in the client JS bundle (F13).
 * Only the filterable variant hydrates a small client island.
 */
export function CommandReference({ limit }: { readonly limit?: number }) {
  if (limit !== undefined) {
    const rows = codeMetadata.commands.slice(0, limit);
    return (
      <div className="not-prose">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 pr-4 font-medium">Command</th>
                <th className="py-2 pr-4 font-medium">Label</th>
                <th className="py-2 pr-4 font-medium">Aliases</th>
                <th className="py-2 font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((cmd) => (
                <tr key={cmd.id} className="border-fd-border/50 border-b align-top">
                  <td className="py-2 pr-4 font-mono text-xs">/{cmd.id}</td>
                  <td className="py-2 pr-4 text-xs">{cmd.label}</td>
                  <td className="text-fd-muted-foreground py-2 pr-4 font-mono text-xs">
                    {cmd.aliases.length > 0 ? cmd.aliases.join(", ") : "—"}
                  </td>
                  <td className="py-2 text-xs leading-relaxed">{cmd.description || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-fd-muted-foreground mt-2 text-xs tabular-nums">
          {codeMetadata.commandCount} shell commands registered in the CLI.
        </p>
      </div>
    );
  }

  return (
    <CommandReferenceFilter commands={codeMetadata.commands} total={codeMetadata.commandCount} />
  );
}
