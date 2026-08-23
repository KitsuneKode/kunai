import { DocsSidebarBanner } from "@/components/layout/docs-sidebar-banner";
import { GithubStarCta } from "@/components/layout/github-star-cta";
import { NavTitle } from "@/components/layout/nav-title";
import {
  IconBook,
  IconClockHour4,
  IconFileText,
  IconMessageReport,
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
        text: "Feedback",
        url: "/feedback",
        icon: <IconMessageReport className="size-4" stroke={1.5} />,
        active: "url",
      },
      {
        text: "Analytics",
        url: "/analytics",
        icon: <IconRadar2 className="size-4" stroke={1.5} />,
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

export const docsSidebar: NonNullable<DocsLayoutProps["sidebar"]> = {
  collapsible: true,
  defaultOpenLevel: 1,
  banner: <DocsSidebarBanner />,
  footer: <GithubStarCta />,
};
