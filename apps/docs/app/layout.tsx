/* eslint-disable import/no-unassigned-import */
import "./global.css";
import { PrivacyAnalytics } from "@/components/analytics/privacy-analytics";
import { PrivacySpeedInsights } from "@/components/analytics/privacy-speed-insights";
import { KunaiFoxRoamer } from "@/components/brand/kunai-fox-roamer";
import { BackToTop } from "@/components/layout/back-to-top";
import { HashScrollFix } from "@/components/layout/hash-scroll-fix";
import { NavCompact } from "@/components/layout/nav-compact";
import { SiteFooter } from "@/components/layout/site-footer";
import { MotionProvider } from "@/components/providers/motion-provider";
import { LazySearchDialog } from "@/components/search/lazy-search-dialog";
import { PullCord } from "@/components/theme/pull-cord";
import { TooltipProvider } from "@/components/ui/tooltip";
import { fontClassNames } from "@/lib/fonts";
/* eslint-enable import/no-unassigned-import */
import { docsSiteUrl } from "@/lib/site";
import { themeBootScript } from "@/lib/themes";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  metadataBase: new URL(docsSiteUrl),
  title: {
    default: "Kunai Docs",
    template: "%s | Kunai · terminal streaming client",
  },
  description:
    "Guides for Kunai, the terminal client for anime, series, movies, and YouTube: resolve a stream, hand off to mpv, recover, and use local offline files.",
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
        {/* Applies a stored coat before first paint so the accent never flashes
            Sakura and swaps — inline and sync so it runs during parse. */}
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        {/* First focusable element on every page: the docs pages land on
            fumadocs' #nd-page wrapper, the home-shell pages carry the same id
            on their own <main> — one anchor covers both layouts. */}
        <a href="#nd-page" className="kunai-skip">
          Skip to content
        </a>
        <RootProvider
          search={{
            SearchDialog: LazySearchDialog,
            links: [
              ["Getting started", "/docs/users/getting-started"],
              ["Troubleshooting", "/docs/users/troubleshooting"],
              ["CLI Reference", "/docs/users/cli-reference"],
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
          <MotionProvider>
            <TooltipProvider>{children}</TooltipProvider>
          </MotionProvider>
          {/* Site-wide footer — a direct DOM child of body (the providers
              render no element), so `mt-auto` pins it to the fold on short
              pages and it sits after the page chrome on every route. */}
          <SiteFooter />
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
        {/* Kanna's aurora + grain — the painterly backdrop. The ribbons read
            the coat tokens, so every coat re-paints the sky and the layer
            crossfades inside the theme view-transition. */}
        <div className="kunai-aurora" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <div className="kunai-grain" aria-hidden="true" />
        {/* Progressive-blur band under the top chrome — content scrolling
            under the nav dissolves instead of clipping. CSS-only. */}
        <div className="kunai-edge-fade" aria-hidden="true" />
        <NavCompact />
        <PullCord />
        <HashScrollFix />
        <BackToTop />
        <KunaiFoxRoamer />
        <PrivacyAnalytics />
        <PrivacySpeedInsights />
      </body>
    </html>
  );
}
