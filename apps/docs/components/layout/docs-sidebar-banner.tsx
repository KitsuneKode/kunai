import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { codeMetadata } from "@/lib/code-metadata";
import { GithubInfo } from "fumadocs-ui/components/github-info";
import Link from "next/link";
import { Suspense } from "react";

export function DocsSidebarBanner() {
  const revision =
    codeMetadata.cliSourceRevision && codeMetadata.cliSourceRevision !== "unknown"
      ? codeMetadata.cliSourceRevision
      : null;

  return (
    <div className="mb-3 flex flex-col gap-3">
      <Card className="border-fd-border bg-fd-card/90">
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-base font-medium">Kunai</CardTitle>
          <CardDescription className="kunai-type-caption tabular-nums">
            v{codeMetadata.version}
            {revision ? ` · ${revision}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          <p className="text-fd-muted-foreground text-xs leading-relaxed tabular-nums">
            {codeMetadata.providerIds.length} providers · {codeMetadata.commandCount} shell commands
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
