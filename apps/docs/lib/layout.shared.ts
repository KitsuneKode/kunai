import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: "Kunai Docs",
      url: "/",
    },
    links: [
      {
        text: "Guides",
        url: "/docs/users/getting-started",
        active: "nested-url",
      },
      {
        text: "Debugging",
        url: "/docs/developer/debugging-workflow",
        active: "nested-url",
      },
    ],
    githubUrl: "https://github.com/KitsuneKode/kunai",
  };
}
