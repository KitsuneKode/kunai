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
    // Two audiences read this list. The top bar (`on: "nav"`) shows every
    // destination. The docs sidebar (`on: "menu"`) used to show the same eight
    // links above its own page tree, which then repeated "Overview", "Guides"
    // and "Debug" a screen lower and pushed the first real doc link below the
    // fold. Only the two destinations that are NOT in the tree, Releases and
    // Analytics, stay in the sidebar; everything else is the footer's job.
    links: [
      {
        text: "Overview",
        url: "/docs",
        icon: <IconFileText className="size-4" stroke={1.5} />,
        active: "url",
        on: "nav",
      },
      {
        text: "Guides",
        url: "/docs/users",
        icon: <IconBook className="size-4" stroke={1.5} />,
        active: "nested-url",
        on: "nav",
      },
      {
        text: "Debug",
        url: "/docs/developer",
        icon: <IconTool className="size-4" stroke={1.5} />,
        active: "nested-url",
        on: "nav",
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
        on: "nav",
      },
      {
        text: "Disclaimer",
        url: "/docs/users/supported-and-unsupported#disclaimer",
        icon: <IconFileText className="size-4" stroke={1.5} />,
        active: "url",
        on: "nav",
      },
      {
        text: "Install",
        url: "/#install",
        icon: <IconTerminal2 className="size-4" stroke={1.5} />,
        on: "nav",
      },
    ],
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
