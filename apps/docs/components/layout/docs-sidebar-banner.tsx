import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { codeMetadata } from "@/lib/code-metadata";
import { GithubInfo } from "fumadocs-ui/components/github-info";
import Link from "next/link";
import { Suspense } from "react";

export function DocsSidebarBanner() {
  return (
    <div className="mb-3 space-y-3">
      <Card className="border-fd-border bg-fd-card/90">
        <CardHeader className="p-3 pb-2">
          <CardDescription className="kunai-type-caption">Kunai CLI</CardDescription>
          <CardTitle className="font-serif text-base font-medium tabular-nums">
            v{codeMetadata.version}
            {codeMetadata.cliSourceRevision && codeMetadata.cliSourceRevision !== "unknown" ? (
              <span className="text-fd-muted-foreground ml-1 text-xs font-normal">
                · {codeMetadata.cliSourceRevision}
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          <p className="text-fd-muted-foreground text-xs leading-relaxed tabular-nums">
            {codeMetadata.providerIds.length} providers · {codeMetadata.commandCount} commands
          </p>
          <Link
            href="/docs/users/cli-reference"
            className="text-fd-primary mt-3 inline-flex min-h-10 items-center text-xs font-medium transition-[color,transform] duration-150 ease-[var(--ease-out)] hover:underline active:scale-[0.96]"
          >
            Open CLI reference →
          </Link>
        </CardContent>
      </Card>
      <Suspense
        fallback={
          <div className="border-fd-border bg-fd-card/90 h-10 animate-pulse rounded-lg border" />
        }
      >
        <GithubInfo
          owner="KitsuneKode"
          repo="kunai"
          className="border-fd-border bg-fd-card/90 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs"
        />
      </Suspense>
    </div>
  );
}
