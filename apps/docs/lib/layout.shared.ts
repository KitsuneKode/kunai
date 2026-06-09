import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import React from "react";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: React.createElement(
        "div",
        { className: "flex items-center gap-2 select-none" },
        React.createElement(
          "div",
          {
            className:
              "h-6 w-6 rounded bg-[#f09cb5] flex items-center justify-center text-[#0b070e] font-bold text-xs tracking-tighter",
          },
          "K",
        ),
        React.createElement(
          "span",
          { className: "font-serif text-white font-medium tracking-tight text-sm" },
          "Kunai",
        ),
      ),
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
      {
        text: "Install CLI",
        url: "/#install",
      },
    ],
    githubUrl: "https://github.com/KitsuneKode/kunai",
  };
}
