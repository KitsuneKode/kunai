import { codeMetadata } from "@/lib/code-metadata";
import Link from "next/link";

export function DocsSidebarBanner() {
  return (
    <div className="kunai-surface-shell mb-3">
      <div className="kunai-surface-shell__inner p-3">
        <p className="kunai-type-caption">Kunai CLI</p>
        <p className="text-fd-foreground mt-2 font-serif text-base font-medium tabular-nums">
          v{codeMetadata.version}
        </p>
        <p className="kunai-hub-stat mt-2 leading-relaxed">
          {codeMetadata.providerIds.length} providers · {codeMetadata.commandCount} commands
        </p>
        <Link
          href="/docs/users/cli-reference"
          className="text-fd-primary mt-3 inline-flex min-h-10 items-center text-xs font-medium transition-[color,transform] duration-150 ease-out hover:underline active:scale-[0.96]"
        >
          Open CLI reference →
        </Link>
      </div>
    </div>
  );
}
