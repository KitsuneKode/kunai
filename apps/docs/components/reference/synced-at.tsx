import { codeMetadata } from "@/lib/code-metadata";

export function SyncedAt() {
  const synced = new Date(codeMetadata.syncedAt);
  const formatted = synced.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });

  return (
    <p className="text-fd-muted-foreground not-prose border-fd-border mt-10 border-t pt-4 text-xs leading-relaxed">
      Reference tables are generated from the Kunai CLI codebase (v{codeMetadata.version}) at{" "}
      {formatted} UTC. Run <code>bun run generate</code> in <code>apps/docs</code> to refresh.
    </p>
  );
}
