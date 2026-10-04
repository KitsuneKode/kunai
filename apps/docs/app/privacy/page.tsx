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
  n,
  title,
  children,
}: {
  readonly n: number;
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="border-fd-border flex flex-col gap-4 border-t pt-8">
      <h2 className="kunai-type-title text-xl">
        <span className="text-fd-muted-foreground mr-2 font-normal tabular-nums">{n}.</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Li({ children }: { readonly children: React.ReactNode }) {
  return <li className="text-fd-muted-foreground text-sm leading-7">— {children}</li>;
}

function Ul({ children }: { readonly children: React.ReactNode }) {
  return <ul className="m-0 grid list-none gap-2 p-0">{children}</ul>;
}

export default function PrivacyPage() {
  return (
    <main className="kunai-home relative mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-14 md:px-10">
      <header className="border-fd-border flex flex-col gap-4 border-b pb-8">
        <h1 className="kunai-display-title max-w-none text-4xl md:text-5xl">Privacy policy</h1>
        <p className="text-fd-muted-foreground max-w-3xl text-base leading-7">
          Kunai is a fun open-source project — a bet on how far a terminal and a hobby codebase can
          actually go. Nobody here wants to know what you watch, and the architecture is built so
          nobody can.
        </p>
        <p className="text-fd-muted-foreground m-0 text-xs">
          Last updated October 2, 2026. Effective October 2, 2026.
        </p>
      </header>

      <Section n={1} title="The deal">
        <P>
          Kunai is a hobby open-source terminal client. It finds a stream someone else is already
          hosting and hands it to mpv. The CLI and this docs website are both covered here, as two
          separate things.
        </P>
      </Section>

      <Section n={2} title="Scope">
        <P>This policy covers:</P>
        <Ul>
          <Li>
            The CLI: setup, playback, history, lists, the queue, downloads, diagnostics, and the
            optional usage ping.
          </Li>
          <Li>
            The docs website, including ordinary pages and share links under{" "}
            <code className="font-mono text-xs">/w/</code>.
          </Li>
        </Ul>
        <P>
          mpv, stream providers, Discord, npm, GitHub, and Vercel are other people's services.
          Section 7 says what they receive from you.
        </P>
      </Section>

      <Section n={3} title="Controller">
        <P>
          Kunai has no legal entity. No company, no registered office, no data-protection officer.
          The maintainer of this hobby project is the controller: the person who decides what the
          CLI and the website do with data. Reach them through GitHub issues and discussions on
          KitsuneKode/kunai. A street address would be fiction, so none is printed here.
        </P>
      </Section>

      <Section n={4} title="What never leaves">
        <P>
          The CLI is local-first. Watch history, lists, the queue, downloads, searches, stream URLs,
          and file paths stay on your machine. No accounts. No sync. Kunai does not upload them.
        </P>
        <P>
          Diagnostics stay local. An exported bundle is redacted on the way out: no stream URLs, no
          cookies, no authorization headers, no private paths.
        </P>
        <P>
          A search or a play press goes from your machine to a provider. The maintainer does not get
          a copy. The provider does.
        </P>
      </Section>

      <Section n={5} title="The one thing you can turn on">
        <P>
          Usage analytics are opt-in only. No code path can enable them without an explicit action
          from you. Skipping setup leaves them off. On, current builds send at most one ping a day:
        </P>
        <Ul>
          <Li>sha256 of a local install id (the id itself stays on the machine)</Li>
          <Li>version</Li>
          <Li>operating system</Li>
          <Li>architecture</Li>
          <Li>timestamp</Li>
        </Ul>
        <P>
          No titles, queries, providers, stream URLs, or file paths. The hash can tie one day to the
          next until you rotate the id or turn this off.
        </P>
        <P>
          Pings go to <code className="font-mono text-xs">analytics.kunai.kitsunekode.in</code>. You
          can point them at a self-hosted https endpoint instead. The ingest server has no code path
          that reads a client IP address. Raw rows are deleted after 35 days. The lifetime figure
          outlives those rows — it is a cumulative count of observations, not of unique people, and
          reinstalls, rotated ids, and invented ids all move it.
        </P>
        <P>
          Turning it off deletes the local install id. Rotate id is available while it stays on;
          older pings do not follow the new id.{" "}
          <code className="font-mono text-xs">DO_NOT_TRACK=1</code> or{" "}
          <code className="font-mono text-xs">CI=true</code> hard-block sends, even if the setting
          is on. Everything we publish sits on the{" "}
          <Link href="/analytics" className="text-fd-primary hover:underline">
            public analytics page
          </Link>
          ; the full contract is{" "}
          <Link
            href="/docs/users/reliability-and-privacy"
            className="text-fd-primary hover:underline"
          >
            Reliability and privacy
          </Link>
          .
        </P>
      </Section>

      <Section n={6} title="What this website sends">
        <P>
          The docs website, not the app, sends page views to Vercel Analytics and web-vitals to
          Vercel Speed Insights. Cookieless. No cross-site tracking. URLs under{" "}
          <code className="font-mono text-xs">/w/</code> are share links that name a watched title —
          they are filtered out before the send.
        </P>
        <P>Kanna wanders this site; she does not take notes.</P>
      </Section>

      <Section n={7} title="Third parties">
        <Ul>
          <Li>
            Stream providers receive your request directly — search, playback, and downloads
            included — and they see your IP address. No proxy and no relay in front of the video.
            That is the design.
          </Li>
          <Li>
            Discord Rich Presence is off by default. On, it uses local IPC to the Discord app on
            your machine. Full presence includes the title. Private mode leaves the title out.
          </Li>
          <Li>npm and GitHub see a download the way they see any other package or release.</Li>
        </Ul>
      </Section>

      <Section n={8} title="Your rights">
        <P>
          Where a GDPR-style law applies, you can seek access, correction, erasure, and a stop.
          Where the CCPA applies, you can seek to know, to delete, and to opt out of sale. We cannot
          identify you, so access and erasure mostly resolve themselves.
        </P>
        <P>
          Your library is on your computer; we have no copy to show, correct, or return. The opt-out
          is the erasure: turning analytics off deletes the local id and new pings stop, raw rows
          already stored are deleted after 35 days, and the lifetime count that remains has no name
          on it. &ldquo;Delete me&rdquo; has no row to find. We do not sell personal information, we
          do not share it for cross-context advertising, and the website sets no analytics cookie.
        </P>
      </Section>

      <Section n={9} title="Children's privacy">
        <P>
          Kunai is not directed at children. We do not knowingly collect personal information from
          them.
        </P>
      </Section>

      <Section n={10} title="International processing">
        <P>
          CLI library data stays on the machine you installed it on. An opt-in ping is processed at{" "}
          <code className="font-mono text-xs">analytics.kunai.kitsunekode.in</code>, or at the https
          endpoint you configured. Page views and web-vitals from this website are processed by
          Vercel in the United States and in the other regions where Vercel runs Analytics and Speed
          Insights.
        </P>
      </Section>

      <Section n={11} title="Disclaimer">
        <P>
          Kunai is a client-side playback tool. It does not host, upload, mirror, seed, or
          distribute content. Streams come from non-affiliated third-party providers. There is no
          guarantee of provider uptime, catalog, legal availability, or subtitle accuracy. Copyright
          belongs to the providers. Beta software, hobby project, no warranty — the full text lives
          at{" "}
          <Link
            href="/docs/users/supported-and-unsupported#disclaimer"
            className="text-fd-primary hover:underline"
          >
            the disclaimer
          </Link>
          .
        </P>
      </Section>

      <Section n={12} title="Changes to this policy">
        <P>
          This policy lives in a public git repository. The commit history is the changelog; when
          the words change, the diff is the notice. Kanna does not run a mailing list.
        </P>
      </Section>

      <Section n={13} title="Governing law">
        <P>
          There is no legal entity, so this policy picks no country, no court, and no venue. It does
          not remove a privacy right you already have where you live.
        </P>
      </Section>

      <Section n={14} title="Contact">
        <P>
          Something here that reads wrong — or worse, a claim the code does not keep — is a bug
          report, not a support ticket:{" "}
          <a
            href={docsGithubIssuesUrl()}
            rel="noreferrer"
            target="_blank"
            className="text-fd-primary hover:underline"
          >
            GitHub issues
          </a>{" "}
          and{" "}
          <a
            href={docsGithubDiscussionsUrl()}
            rel="noreferrer"
            target="_blank"
            className="text-fd-primary hover:underline"
          >
            discussions
          </a>{" "}
          on KitsuneKode/kunai.
        </P>
      </Section>
    </main>
  );
}
