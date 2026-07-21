import { codeMetadata, type PublicShortcutMetadata } from "@/lib/code-metadata";

function rowsForTier(tier?: "core" | "surface"): readonly PublicShortcutMetadata[] {
  const rows = codeMetadata.shortcuts ?? [];
  const filtered = tier ? rows.filter((row) => row.tier === tier) : rows;
  return [...filtered].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/**
 * Registry-backed shortcut table. Defaults to the full deliberate public set
 * (core + surface). Pass `tier="core"` for the README-sized subset.
 */
export function ShortcutTable({ tier }: { readonly tier?: "core" | "surface" } = {}) {
  const rows = rowsForTier(tier);

  return (
    <div className="not-prose">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 pr-4 font-medium">Context</th>
              <th className="py-2 pr-4 font-medium">Keys</th>
              <th className="py-2 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-fd-border/50 border-b align-top">
                <td className="py-2 pr-4 text-xs">{row.group}</td>
                <td className="py-2 pr-4 font-mono text-xs whitespace-nowrap">{row.keys}</td>
                <td className="py-2 text-xs leading-relaxed">{row.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-fd-muted-foreground mt-2 text-xs tabular-nums">
        {rows.length} stable shortcuts from the keybinding registry
        {tier ? ` (${tier})` : ""}. Press <span className="font-mono">?</span> in the shell for the
        full live help overlay.
      </p>
    </div>
  );
}
