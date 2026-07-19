import { DocsSidebarBanner } from "@/components/layout/docs-sidebar-banner";
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
    githubUrl: "https://github.com/KitsuneKode/kunai",
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
        text: "Telemetry",
        url: "/telemetry",
        icon: <IconRadar2 className="size-4" stroke={1.5} />,
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
};
