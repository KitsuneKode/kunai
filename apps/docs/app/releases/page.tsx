import { latestReleaseNotesArtifact, readReleaseNotesArtifacts } from "@/lib/release-notes";
import { docsSiteUrl } from "@/lib/site";
import type { Metadata } from "next";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Release Notes",
  description: "Kunai release notes generated from the tracked release artifact.",
  alternates: {
    canonical: `${docsSiteUrl}/releases`,
  },
  openGraph: {
    title: "Kunai Release Notes",
    description: "Kunai release notes generated from the tracked release artifact.",
    url: `${docsSiteUrl}/releases`,
    type: "website",
    siteName: "Kunai Docs",
  },
  twitter: {
    card: "summary_large_image",
    title: "Kunai Release Notes",
    description: "Kunai release notes generated from the tracked release artifact.",
  },
};

export default function ReleaseNotesPage() {
  const releases = readReleaseNotesArtifacts();
  const latest = latestReleaseNotesArtifact();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-14 md:px-10">
      <header className="border-fd-border flex flex-col gap-4 border-b pb-8">
        <p className="text-fd-muted-foreground text-sm font-medium">Release notes</p>
        <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">Kunai releases</h1>
        <p className="text-fd-muted-foreground max-w-3xl text-base leading-7">
          Generated from the same tracked release artifact used for the GitHub release body.
        </p>
      </header>

      {latest ? (
        <section className="grid gap-6">
          <article className="border-fd-border bg-fd-card rounded-lg border p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-fd-muted-foreground text-sm">{latest.tag}</p>
                <h2 className="mt-1 text-2xl font-semibold">{latest.title}</h2>
              </div>
              <a
                className="text-fd-primary text-sm font-medium underline-offset-4 hover:underline"
                href={latest.install.binaryLatest}
              >
                GitHub release
              </a>
            </div>
            <p className="text-fd-muted-foreground mt-5 max-w-3xl text-sm leading-6 whitespace-pre-line">
              {latest.summary}
            </p>
            <div className="border-fd-border bg-fd-background mt-6 grid gap-3 rounded-md border p-4 text-sm">
              <code>{latest.install.bunx}</code>
              <code>{latest.install.npm}</code>
            </div>
          </article>

          {latest.sections.map((section) => (
            <section key={section.title} className="border-fd-border rounded-lg border p-6">
              <h3 className="text-xl font-semibold">{section.title}</h3>
              <ul className="text-fd-muted-foreground mt-4 grid gap-3 text-sm leading-6">
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ))}
        </section>
      ) : (
        <p className="text-fd-muted-foreground text-sm">No release artifacts are available.</p>
      )}

      {releases.length > 1 ? (
        <section className="border-fd-border border-t pt-8">
          <h2 className="text-xl font-semibold">Previous releases</h2>
          <div className="mt-4 grid gap-3">
            {releases.slice(1).map((release) => (
              <div
                key={release.tag}
                className="border-fd-border flex items-center justify-between rounded-md border p-4"
              >
                <span>{release.title}</span>
                <span className="text-fd-muted-foreground text-sm">{release.tag}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
