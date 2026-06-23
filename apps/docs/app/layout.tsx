/* eslint-disable import/no-unassigned-import */
import "./global.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { fontClassNames } from "@/lib/fonts";
/* eslint-enable import/no-unassigned-import */
import { docsSiteUrl } from "@/lib/site";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  metadataBase: new URL(docsSiteUrl),
  title: {
    default: "Kunai Docs",
    template: "%s | Kunai Docs",
  },
  description: "Guides for Kunai playback, recovery, offline use, diagnostics, and reliability.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#100b0f",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`dark ${fontClassNames}`}>
      <body className="bg-fd-background text-fd-foreground flex min-h-screen flex-col antialiased">
        <RootProvider
          search={{
            options: {
              api: "/api/search",
            },
          }}
          theme={{
            forcedTheme: "dark",
            enableSystem: false,
          }}
        >
          <TooltipProvider>{children}</TooltipProvider>
        </RootProvider>
      </body>
    </html>
  );
}
