import { docsGithubDiscussionsUrl, docsGithubIssuesUrl } from "@/lib/docs-github";
import { buildPageMetadata } from "@/lib/page-metadata";
import type { Metadata } from "next";
import Link from "next/link";

export const dynamic = "force-static";

export const metadata: Metadata = buildPageMetadata({
  title: "Kunai privacy: what leaves your machine (very little)",
  absoluteTitle: true,
  description:
    "What Kunai stores locally, the one analytics ping you can opt into, what this docs site sends, and what third parties see when you stream.",
  socialDescription:
    "Kunai is local-first: everything is off until you turn it on, and the only opt-in telemetry is a daily anonymous ping.",
  path: "/privacy",
});

function P({ children }: { readonly children: React.ReactNode }) {
  return <p className="text-fd-muted-foreground m-0 text-sm leading-7">{children}</p>;
}

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="border-fd-border flex flex-col gap-4 border-t pt-8">
      <h2 className="kunai-type-title text-xl">{title}</h2>
      {children}
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="kunai-home relative mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-14 md:px-10">
      <header className="border-fd-border flex flex-col gap-4 border-b pb-8">
        <h1 className="kunai-display-title max-w-none text-4xl md:text-5xl">Privacy</h1>
        <p className="text-fd-muted-foreground max-w-3xl text-base leading-7">
          Kunai is a fun open-source project: a bet on how far a terminal and a hobby codebase can
          actually go. Nobody here wants to know what you watch, and the architecture is built so
          nobody can. The short version is that almost nothing leaves your machine — and the long
          version, below, says exactly what does.
        </p>
      </header>

      <section className="kunai-surface-shell p-1">
        <div className="kunai-surface-shell__inner border-fd-border rounded-[calc(var(--kunai-radius-outer)-0.15rem)] border p-6">
          <h2 className="kunai-type-title text-lg">The deal</h2>
          <P>
            Your history, lists, queue, downloads, searches, and settings live in your OS profile
            directory and stay there. There is no account, no sync service, and no cloud copy of
            what you watched. The app is complete with every optional send switched off — privacy is
            the default state, not a settings achievement you unlock. The nice thing about
            collecting almost nothing is that there is almost nothing to protect, leak, or sell.
          </P>
        </div>
      </section>

      <Section title="What never leaves your machine">
        <ul className="text-fd-muted-foreground m-0 grid list-none gap-2 p-0 text-sm leading-7">
          <li>— Titles you search for, watch, queue, download, or mark as watched</li>
          <li>— Stream URLs, provider responses, and file paths</li>
          <li>
            — Diagnostics bundles stay local; if you export one to attach to a bug report it is
            redacted first — no stream URLs, cookies, auth headers, or private paths
          </li>
          <li>
            — Your IP address. The analytics ingest has no code path that reads one, so there is
            nothing to log, discard, or hand over
          </li>
        </ul>
      </Section>

      <Section title="The one thing you can turn on">
        <P>
          Usage analytics are off until you explicitly turn them on in Settings. Setup asks once and
          recommends it, but no skip, default, or non-interactive path can enable it — an install
          that never said yes simply never sends. While on, Kunai sends at most one small ping a
          day: a sha256 digest of your local install id (never the id itself), the version, OS, and
          architecture. That is the whole payload.
        </P>
        <P>
          Turning it off deletes the install id from disk. You can rotate the id anytime, and{" "}
          <code className="font-mono text-xs">DO_NOT_TRACK=1</code> or{" "}
          <code className="font-mono text-xs">CI=true</code> hard-blocks sends regardless of the
          setting. Raw rows live 35 days; the lifetime number is cumulative observations, not a
          people count. Everything published sits on the{" "}
          <Link href="/analytics" className="text-fd-primary hover:underline">
            public analytics page
          </Link>{" "}
          — the same numbers we see, with small groups suppressed. The full contract is{" "}
          <Link
            href="/docs/users/reliability-and-privacy"
            className="text-fd-primary hover:underline"
          >
            Reliability and privacy
          </Link>
          .
        </P>
      </Section>

      <Section title="What this website sends">
        <P>
          The docs site reports page views and load timings to Vercel Analytics and Speed Insights —
          the platform hosting it. Those events are cookieless and carry no account data, and the
          send is filtered so <code className="font-mono text-xs">/w/</code> share-link pages never
          report: a share link names what you were watching, and that stays out of telemetry. If
          that trade-off bothers you, a content blocker removes it harmlessly; the site works the
          same without it.
        </P>
      </Section>

      <Section title="What third parties see when you use Kunai">
        <ul className="text-fd-muted-foreground m-0 grid list-none gap-2 p-0 text-sm leading-7">
          <li>
            — <strong className="text-fd-foreground font-medium">Providers.</strong> Kunai asks
            third-party providers for streams directly — no proxy, no relay for media. Your request
            and IP go to whoever serves the stream; that is how direct streaming works and it is the
            whole point of the design.
          </li>
          <li>
            — <strong className="text-fd-foreground font-medium">Discord.</strong> Rich Presence is
            off by default and connects over a local socket, no cloud relay. In `full` mode your
            Discord friends can see the title you are watching; `private` mode shows generic
            activity instead. Entirely your call.
          </li>
          <li>
            — <strong className="text-fd-foreground font-medium">npm and GitHub.</strong> Installing
            via npm or the GitHub releases page counts as a download on those platforms — they see
            what any download sees, and nothing more.
          </li>
        </ul>
      </Section>

      <Section title="The disclaimer, since you are here">
        <P>
          Kunai is a client-side playback tool. It does not host, upload, mirror, seed, or
          distribute video content; streams are served by non-affiliated third-party providers, and
          copyright notices belong to them. Use it responsibly and in line with the laws and service
          terms where you live. It is beta software built for fun — we cannot guarantee provider
          uptime, catalog completeness, legal availability in your jurisdiction, or that a subtitle
          file behaves itself. Full text:{" "}
          <Link
            href="/docs/users/supported-and-unsupported#disclaimer"
            className="text-fd-primary hover:underline"
          >
            the disclaimer
          </Link>
          .
        </P>
      </Section>

      <Section title="Questions or a privacy bug">
        <P>
          Something here that reads wrong, or worse, a claim the code does not keep? That is a bug
          report, not a support ticket — file it on{" "}
          <a
            href={docsGithubIssuesUrl()}
            rel="noreferrer"
            target="_blank"
            className="text-fd-primary hover:underline"
          >
            GitHub issues
          </a>{" "}
          or ask in{" "}
          <a
            href={docsGithubDiscussionsUrl()}
            rel="noreferrer"
            target="_blank"
            className="text-fd-primary hover:underline"
          >
            discussions
          </a>
          . Kanna the fox wanders this site; she does not take notes.
        </P>
      </Section>
    </main>
  );
}
