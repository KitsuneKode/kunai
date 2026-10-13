import { KannaRestoreButton } from "@/components/brand/kanna-restore-button";
import { DocsSidebarBanner } from "@/components/layout/docs-sidebar-banner";
import { GithubStarCta } from "@/components/layout/github-star-cta";
import { NavTitle } from "@/components/layout/nav-title";
import { SUPPORT_PATH } from "@/lib/support";
import {
  IconBook,
  IconClockHour4,
  IconFileText,
  IconHeart,
  IconRadar2,
  IconTerminal2,
  IconTool,
} from "@tabler/icons-react";
import type { DocsLayoutProps } from "fumadocs-ui/layouts/docs";
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <NavTitle />,
      url: "/",
      transparentMode: "top",
    },
    themeSwitch: {
      enabled: false,
    },
    searchToggle: {
      enabled: true,
    },
    // No `githubUrl`: fumadocs turns it into an icon link item that renders in
    // the docs sidebar, where `GithubStarCta` already lives — the two stacked as
    // a bare unlabelled pill above a labelled one. Each surface now carries
    // exactly one GitHub control: `HomeStarCta` in the hero, `GithubStarCta` in
    // the sidebar footer, both labelled and both showing the star count.
    // `on` stays unset on every link here: fumadocs feeds anything that is not
    // `on: "nav"` into `menuItems`, and `menuItems` is both the docs sidebar
    // AND the home layout's mobile menu — the only way a phone reaches these
    // pages. The docs sidebar's restriction (only Releases and Analytics,
    // which its page tree does not already cover) lives in `docsOptions()`.
    links: [
      {
        text: "Overview",
        url: "/docs",
        icon: <IconFileText className="size-4" stroke={1.5} />,
        active: "url",
      },
      {
        text: "Guides",
        url: "/docs/users",
        icon: <IconBook className="size-4" stroke={1.5} />,
        active: "nested-url",
      },
      {
        text: "Debug",
        url: "/docs/developer",
        icon: <IconTool className="size-4" stroke={1.5} />,
        active: "nested-url",
      },
      {
        text: "Releases",
        url: "/releases",
        icon: <IconClockHour4 className="size-4" stroke={1.5} />,
        active: "nested-url",
      },
      {
        text: "Analytics",
        url: "/analytics",
        icon: <IconRadar2 className="size-4" stroke={1.5} />,
        active: "url",
      },
      {
        text: "Support",
        url: SUPPORT_PATH,
        icon: <IconHeart className="size-4" stroke={1.5} />,
        active: "url",
      },
      {
        text: "Disclaimer",
        url: "/docs/users/supported-and-unsupported#disclaimer",
        icon: <IconFileText className="size-4" stroke={1.5} />,
        active: "url",
      },
      {
        text: "Install",
        url: "/#install",
        icon: <IconTerminal2 className="size-4" stroke={1.5} />,
      },
    ],
  };
}

/** Top-level destinations the docs page tree does not already cover — the only
 *  links that belong in the docs sidebar above that tree. */
const DOCS_SIDEBAR_URLS: ReadonlySet<string> = new Set(["/releases", "/analytics"]);

/**
 * Options for the DocsLayout. Same shell as `baseOptions()`, but every link the
 * docs page tree already covers is marked `on: "nav"`: the docs sidebar renders
 * `menuItems` above the tree, and the unmarked list used to repeat "Overview",
 * "Guides" and "Debug" a screen above themselves, pushing the first real doc
 * link below the fold.
 *
 * This must stay out of `baseOptions()`: there, `on: "nav"` would also strip
 * the links from the home layout's mobile menu, where they are the only
 * navigation a phone has.
 */
export function docsOptions(): BaseLayoutProps {
  const base = baseOptions();
  return {
    ...base,
    links: base.links?.map((link) =>
      "url" in link && link.url && !DOCS_SIDEBAR_URLS.has(link.url)
        ? { ...link, on: "nav" as const }
        : link,
    ),
  };
}

export const docsSidebar: NonNullable<DocsLayoutProps["sidebar"]> = {
  collapsible: true,
  defaultOpenLevel: 1,
  banner: <DocsSidebarBanner />,
  footer: (
    <>
      <GithubStarCta />
      <KannaRestoreButton />
    </>
  ),
};
