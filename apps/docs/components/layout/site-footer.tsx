import { KunaiFox } from "@/components/brand/kunai-fox";
import { codeMetadata } from "@/lib/code-metadata";
import { docsGithubIssuesUrl, docsGithubRepoUrl } from "@/lib/docs-github";
import Link from "next/link";

/**
 * The site footer — every surface's last read.
 *
 * Four columns, each answering a different "where next": the docs themselves,
 * the project's own surfaces, the trust pages, and the sibling tools. External
 * entries open in a new tab and are marked as such for assistive tech; internal
 * entries go through `Link` so they ride the app router.
 *
 * It lives in the root layout rather than a fumadocs slot because fumadocs has
 * no site-footer slot — `slots.footer` is the per-page edit block, not this.
 * One placement covers the landing page, the docs tree, and the standalone
 * surfaces (analytics, releases, feedback) identically.
 */

type FooterLink = {
  readonly href: string;
  readonly label: string;
  readonly external?: boolean;
};

const DOCS_LINKS: readonly FooterLink[] = [
  { href: "/docs/users/getting-started", label: "Getting started" },
  { href: "/docs/users/install-and-update", label: "Install & update" },
  { href: "/docs/users/cli-reference", label: "CLI reference" },
  { href: "/docs/users/troubleshooting", label: "Troubleshooting" },
  { href: "/docs", label: "All documentation" },
];

const PROJECT_LINKS: readonly FooterLink[] = [
  { href: "/releases", label: "Releases" },
  { href: "/analytics", label: "Usage analytics" },
  { href: "/feedback", label: "Feedback" },
  { href: "/docs/users/kanna", label: "Kanna, the fox" },
];

const TRUST_LINKS: readonly FooterLink[] = [
  { href: "/docs/users/reliability-and-privacy", label: "Privacy & reliability" },
  { href: "/docs/users/supported-and-unsupported#disclaimer", label: "Disclaimer" },
  { href: docsGithubIssuesUrl(), label: "Report an issue", external: true },
  { href: docsGithubRepoUrl(), label: "GitHub", external: true },
  {
    href: "https://www.npmjs.com/package/@kitsunekode/kunai",
    label: "npm package",
    external: true,
  },
];

/** Sibling tools from the same workshop — each is its own project, not a Kunai feature. */
const ECOSYSTEM_LINKS: readonly FooterLink[] = [
  {
    href: "https://github.com/KitsuneKode/kittymux",
    label: "kittymux",
    external: true,
  },
  {
    href: "https://github.com/KitsuneKode/sweep",
    label: "sweep",
    external: true,
  },
  {
    href: "https://github.com/KitsuneKode/portless",
    label: "portless",
    external: true,
  },
  {
    href: "https://github.com/KitsuneKode/run-cli",
    label: "run-cli",
    external: true,
  },
  {
    href: "https://github.com/KitsuneKode/arche",
    label: "arche",
    external: true,
  },
];

function FooterLinkItem({ link }: { readonly link: FooterLink }) {
  const className =
    "text-fd-muted-foreground hover:text-fd-foreground text-sm transition-colors duration-150";
  if (link.external) {
    return (
      <a href={link.href} rel="noreferrer" target="_blank" className={className}>
        {link.label}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    );
  }
  return (
    <Link href={link.href} className={className}>
      {link.label}
    </Link>
  );
}

function FooterColumn({
  title,
  links,
}: {
  readonly title: string;
  readonly links: readonly FooterLink[];
}) {
  return (
    <nav aria-label={title} className="flex flex-col gap-2.5">
      <h2 className="text-fd-foreground text-xs font-medium tracking-[0.14em] uppercase">
        {title}
      </h2>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {links.map((link) => (
          <li key={link.href}>
            <FooterLinkItem link={link} />
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-fd-border mt-auto border-t">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-12 md:px-10">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-5">
          <div className="col-span-2 flex max-w-xs flex-col gap-3 sm:col-span-3 lg:col-span-1">
            <Link
              href="/"
              className="text-fd-foreground inline-flex w-fit items-center gap-2.5"
              aria-label="Kunai home"
            >
              <KunaiFox pose="idle" size={28} compact />
              <span className="text-[1.05rem] font-medium tracking-tight">Kunai</span>
            </Link>
            <p className="text-fd-muted-foreground m-0 text-sm leading-6 text-pretty">
              A terminal client that finds anime, series, movies, and YouTube streams and plays them
              in mpv.
            </p>
          </div>
          <FooterColumn title="Docs" links={DOCS_LINKS} />
          <FooterColumn title="Project" links={PROJECT_LINKS} />
          <FooterColumn title="Trust" links={TRUST_LINKS} />
          <FooterColumn title="Also by KitsuneKode" links={ECOSYSTEM_LINKS} />
        </div>
        <div className="border-fd-border text-fd-muted-foreground flex flex-col gap-2 border-t pt-6 text-xs sm:flex-row sm:items-center sm:justify-between">
          <p className="m-0">
            © {new Date().getFullYear()} KitsuneKode. Docs for Kunai v{codeMetadata.cliVersion}.
          </p>
          <p className="m-0">Kanna, the fox, wanders these pages.</p>
        </div>
      </div>
    </footer>
  );
}
