import { codeMetadata } from "@/lib/code-metadata";
import { provenance } from "@/lib/provenance";
import Link from "next/link";

export function SyncedAt() {
  const synced = new Date(provenance.syncedAt);
  const formatted = synced.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });

  return (
    <p className="text-fd-muted-foreground not-prose border-fd-border mt-10 border-t pt-4 text-xs leading-relaxed">
      Command and provider tables on this page are generated from the Kunai CLI (v
      {codeMetadata.version}) at {formatted} UTC
      {provenance.cliSourceRevision && provenance.cliSourceRevision !== "unknown"
        ? ` · source ${provenance.cliSourceRevision}`
        : null}
      . Run <code>bun run --cwd apps/docs generate</code> after registry changes.{" "}
      <Link href="/docs/developer/docs-maintenance" className="text-fd-primary hover:underline">
        Docs maintenance
      </Link>
    </p>
  );
}
