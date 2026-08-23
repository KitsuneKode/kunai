import { codeMetadata } from "@/lib/code-metadata";
import { provenance } from "@/lib/provenance";
import Link from "next/link";

export function DocsSidebarBanner() {
  const revision =
    provenance.cliSourceRevision && provenance.cliSourceRevision !== "unknown"
      ? provenance.cliSourceRevision
      : null;
  const commitUrl = revision ? `https://github.com/KitsuneKode/kunai/commit/${revision}` : null;

  return (
    <div
      data-sidebar-banner
      className="mb-3 flex flex-col gap-2 border-b border-[var(--kunai-line)] pb-3"
    >
      <p className="text-fd-muted-foreground m-0 text-xs leading-relaxed tabular-nums">
        <Link
          href="/releases"
          className="text-fd-foreground font-medium underline-offset-4 hover:underline"
        >
          v{codeMetadata.version}
        </Link>
        {revision && commitUrl ? (
          <>
            {" · "}
            <a
              href={commitUrl}
              className="text-fd-muted-foreground underline-offset-4 hover:underline"
              rel="noreferrer"
              target="_blank"
            >
              {revision.slice(0, 7)}
            </a>
          </>
        ) : null}
      </p>
      {/* Each count links to the page that actually lists it — a number with
          nowhere to go is the reason this block read as decoration. */}
      <p className="text-fd-muted-foreground m-0 text-xs tabular-nums">
        <Link
          className="hover:text-fd-foreground underline-offset-4 hover:underline"
          href="/docs/users/providers"
        >
          {codeMetadata.providerIds.length} providers
        </Link>
        {" · "}
        <Link
          className="hover:text-fd-foreground underline-offset-4 hover:underline"
          href="/docs/users/commands-and-shortcuts#every-shell-command"
        >
          {codeMetadata.commandCount} shell commands
        </Link>
      </p>
      <Link
        href="/docs/users/cli-reference"
        className="text-fd-primary inline-flex min-h-8 items-center text-xs font-medium transition-[color,transform] duration-150 ease-[var(--ease-out)] hover:underline active:scale-[0.96]"
      >
        Launch flags reference →
      </Link>
    </div>
  );
}
