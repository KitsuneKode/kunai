/* eslint-disable import/no-unassigned-import */
import "./global.css";
import { PrivacyAnalytics } from "@/components/analytics/privacy-analytics";
import { KunaiFoxRoamer } from "@/components/brand/kunai-fox-roamer";
import { KunaiSearchDialog } from "@/components/search/kunai-search-dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { fontClassNames } from "@/lib/fonts";
/* eslint-enable import/no-unassigned-import */
import { docsSiteUrl } from "@/lib/site";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  metadataBase: new URL(docsSiteUrl),
  title: {
    default: "Kunai Docs",
    template: "%s | Kunai — terminal streaming client",
  },
  description:
    "Guides for the Kunai client: resolve third-party streams, hand off to mpv, recover, and use local offline files.",
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
            SearchDialog: KunaiSearchDialog,
            links: [
              ["Getting started", "/docs/users/getting-started"],
              ["Troubleshooting", "/docs/users/troubleshooting"],
              ["CLI reference", "/docs/users/cli-reference"],
              ["Documentation index", "/docs"],
            ],
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
        {/* A direct child of <body>, not nested in the provider tree: `position:
            fixed` resolves against the nearest transformed ancestor, and page
            chrome is full of transforms. Here she is always viewport-relative.

            Safe under every rendering mode this site uses. She renders `null`
            until a mount effect has checked pointer type, reduced motion and
            the stored dismissal, so static and server output contain nothing of
            her and there is no hydration mismatch to reconcile. She holds no
            server data, so ISR revalidation never invalidates her.

            Living in the root layout also means she survives route changes
            rather than remounting — she keeps walking while you navigate. */}
        <KunaiFoxRoamer />
        <PrivacyAnalytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
