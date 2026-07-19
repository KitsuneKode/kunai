import {
  docsGithubDiscussionsUrl,
  docsGithubIssueTemplateUrl,
  docsGithubIssuesUrl,
} from "@/lib/docs-github";
import { docsSiteUrl } from "@/lib/site";
import {
  IconBug,
  IconMessageCircle,
  IconPuzzle,
  IconRocket,
  IconSearch,
} from "@tabler/icons-react";
import type { Metadata } from "next";
import Link from "next/link";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Feedback",
  description:
    "Report bugs, provider issues, or feature ideas for Kunai via GitHub issue templates.",
  alternates: {
    canonical: `${docsSiteUrl}/feedback`,
  },
  openGraph: {
    title: "Kunai Feedback",
    description:
      "Report bugs, provider issues, or feature ideas for Kunai via GitHub issue templates.",
    url: `${docsSiteUrl}/feedback`,
    type: "website",
    siteName: "Kunai Docs",
  },
};

const ACTIONS = [
  {
    title: "Report a bug",
    description: "Playback stuck, crash, wrong resume, or shell confusion - use the bug template.",
    href: docsGithubIssueTemplateUrl("bug_report.yml"),
    icon: IconBug,
  },
  {
    title: "Provider broken",
    description: "A direct provider fails to resolve, geo-blocks, or returns empty streams.",
    href: docsGithubIssueTemplateUrl("provider_issue.yml"),
    icon: IconPuzzle,
  },
  {
    title: "Feature request",
    description: "Propose a shell, docs, or provider capability that fits beta scope.",
    href: docsGithubIssueTemplateUrl("feature_request.yml"),
    icon: IconRocket,
  },
  {
    title: "Browse open issues",
    description: "Check whether someone already filed the same problem before opening a new one.",
    href: docsGithubIssuesUrl(),
    icon: IconSearch,
  },
  {
    title: "Discussions",
    description: "Questions and ideas that are not ready to be a tracked issue.",
    href: docsGithubDiscussionsUrl(),
    icon: IconMessageCircle,
  },
] as const;

export default function FeedbackPage() {
  return (
    <main className="kunai-home relative mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-14 md:px-10">
      <header className="border-fd-border flex flex-col gap-4 border-b pb-8">
        <h1 className="kunai-display-title max-w-none text-4xl md:text-5xl">Feedback</h1>
        <p className="text-fd-muted-foreground max-w-3xl text-base leading-7">
          Kunai does not collect in-app telemetry forms here. File issues on GitHub with the
          templates maintainers already triage. Attach redacted diagnostics when playback fails.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        {ACTIONS.map((action) => {
          const Icon = action.icon;
          return (
            <a
              key={action.href}
              href={action.href}
              className="kunai-surface-shell group p-1 transition-transform duration-150 hover:-translate-y-0.5"
              rel="noreferrer"
              target="_blank"
            >
              <div className="kunai-surface-shell__inner border-fd-border flex h-full flex-col gap-3 rounded-[calc(var(--kunai-radius-outer)-0.15rem)] border p-5">
                <Icon className="text-fd-primary size-5" stroke={1.5} />
                <h2 className="kunai-type-title text-lg group-hover:underline">{action.title}</h2>
                <p className="text-fd-muted-foreground m-0 text-sm leading-6">
                  {action.description}
                </p>
              </div>
            </a>
          );
        })}
      </section>

      <section className="border-fd-border rounded-lg border p-6">
        <h2 className="kunai-type-title text-xl">Before you file</h2>
        <ul className="text-fd-muted-foreground mt-4 grid gap-3 text-sm leading-6">
          <li>
            Read{" "}
            <Link href="/docs/users/troubleshooting" className="text-fd-primary hover:underline">
              troubleshooting
            </Link>{" "}
            for common recovery (`/recover`, `/fallback`, `/diagnostics`).
          </li>
          <li>
            Export a redacted bundle with{" "}
            <code className="font-mono text-xs">/export-diagnostics</code> when something fails in a
            live session.
          </li>
          <li>
            Confirm install with{" "}
            <Link href="/docs/users/getting-started" className="text-fd-primary hover:underline">
              getting started
            </Link>{" "}
            and check{" "}
            <Link href="/releases" className="text-fd-primary hover:underline">
              releases
            </Link>{" "}
            for known changes.
          </li>
        </ul>
      </section>
    </main>
  );
}
