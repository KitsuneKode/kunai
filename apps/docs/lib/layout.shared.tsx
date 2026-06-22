import { DocsSidebarBanner } from "@/components/layout/docs-sidebar-banner";
import { NavTitle } from "@/components/layout/nav-title";
import type { DocsLayoutProps } from "fumadocs-ui/layouts/docs";
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { BookOpen, FileClock, FileText, Terminal, Wrench } from "lucide-react";

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
        type: "icon",
        label: "Documentation home",
        text: "Docs",
        icon: <FileText className="size-4" />,
        url: "/docs",
        active: "nested-url",
      },
      {
        type: "icon",
        label: "User guides",
        text: "Guides",
        icon: <BookOpen className="size-4" />,
        url: "/docs/users",
        active: "nested-url",
      },
      {
        type: "icon",
        label: "Developer debugging",
        text: "Debug",
        icon: <Wrench className="size-4" />,
        url: "/docs/developer",
        active: "nested-url",
      },
      {
        type: "icon",
        label: "Release notes",
        text: "Releases",
        icon: <FileClock className="size-4" />,
        url: "/releases",
        active: "nested-url",
      },
      {
        text: "Install",
        url: "/#install",
        icon: <Terminal className="size-4" />,
      },
    ],
  };
}

export const docsSidebar: NonNullable<DocsLayoutProps["sidebar"]> = {
  collapsible: true,
  defaultOpenLevel: 1,
  banner: <DocsSidebarBanner />,
};
