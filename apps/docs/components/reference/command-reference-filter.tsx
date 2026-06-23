"use client";

import type { CommandMetadata } from "@/lib/code-metadata";
import { useMemo, useState } from "react";

type CommandReferenceFilterProps = {
  readonly commands: readonly CommandMetadata[];
  readonly total: number;
};

export function CommandReferenceFilter({ commands, total }: CommandReferenceFilterProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return commands;
    return commands.filter(
      (cmd) =>
        cmd.id.includes(normalized) ||
        cmd.label.toLowerCase().includes(normalized) ||
        cmd.description.toLowerCase().includes(normalized) ||
        cmd.aliases.some((alias) => alias.toLowerCase().includes(normalized)),
    );
  }, [commands, query]);

  return (
    <div className="not-prose">
      <label className="mb-3 block text-sm" htmlFor="command-reference-filter">
        <span className="text-fd-muted-foreground mb-1 block text-xs">Filter commands</span>
        <input
          id="command-reference-filter"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name, alias, or description"
          aria-label="Filter commands"
          className="border-fd-border bg-fd-background focus-visible:ring-fd-ring w-full max-w-md rounded-lg border px-3 py-2 text-sm transition-[border-color,box-shadow] duration-[var(--dur-pop)] ease-[var(--ease-out)] focus-visible:ring-2 focus-visible:outline-none"
        />
      </label>
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
            {filtered.map((cmd) => (
              <tr key={cmd.id} className="border-fd-border/50 border-b align-top">
                <td className="py-2 pr-4 font-mono text-xs">/{cmd.id}</td>
                <td className="py-2 pr-4 text-xs">{cmd.label}</td>
                <td className="text-fd-muted-foreground py-2 pr-4 font-mono text-xs">
                  {cmd.aliases.length > 0 ? cmd.aliases.join(", ") : "—"}
                </td>
                <td className="py-2 text-xs leading-relaxed">{cmd.description || "—"}</td>
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-fd-muted-foreground py-4 text-center text-xs">
                  No commands match “{query}”. Clear the filter to see all {total}.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="text-fd-muted-foreground mt-2 text-xs tabular-nums">
        {total} shell commands registered in the CLI.
      </p>
    </div>
  );
}
