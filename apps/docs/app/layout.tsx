/* eslint-disable import/no-unassigned-import */
import "fumadocs-ui/style.css";
import "./global.css";
/* eslint-enable import/no-unassigned-import */
import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: {
    default: "Kunai Docs",
    template: "%s | Kunai Docs",
  },
  description: "Guides for Kunai playback, recovery, offline use, diagnostics, and reliability.",
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
