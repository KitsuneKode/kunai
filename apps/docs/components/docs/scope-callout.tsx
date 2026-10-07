import { Callout } from "fumadocs-ui/components/callout";
import type { ReactNode } from "react";

type ScopeCalloutProps = {
  readonly variant?: "beta" | "privacy" | "providers" | "downloads";
  readonly title?: string;
  readonly children?: ReactNode;
};

const copy: Record<
  NonNullable<ScopeCalloutProps["variant"]>,
  { type: "info" | "warn" | "idea"; title: string; body: ReactNode }
> = {
  beta: {
    type: "info",
    title: "Beta: what to know first",
    body: (
      <>
        <strong>Install.</strong> Use <code>install.sh</code> or <code>install.ps1</code>. They
        install a self-contained binary, so you need neither Bun nor Node. The Bun and npm installs
        also work; npm needs Node on <code>PATH</code>.
        <br />
        <strong>Playback.</strong> You need <strong>mpv</strong> to play anything. Setup and
        browsing work without it.
        <br />
        <strong>Providers.</strong> Kunai is a client-side tool. It does not host, mirror or
        distribute video. Streams come from third-party providers it is not affiliated with, so use
        it in line with the law and each provider&apos;s terms. Providers change, which is what the
        recovery commands are for.
      </>
    ),
  },
  privacy: {
    type: "idea",
    title: "Privacy by default",
    body: (
      <>
        Watch history and playlists are durable local data. Stream URLs, provider caches, and trace
        rows are disposable. Exported diagnostics are redacted - no raw stream URLs, auth tokens, or
        private home paths in support bundles unless you paste them yourself.
      </>
    ),
  },
  providers: {
    type: "warn",
    title: "Third-party providers",
    body: (
      <>
        Kunai sends local HTTP requests to registered third-party adapters. It does not operate
        streaming infrastructure, guarantee catalog completeness, or bypass DRM. When a provider
        fails, use <code>/recover</code>, then <code>/fallback</code> (or <code>Shift+F</code>{" "}
        during playback), then <code>/diagnostics</code>; each command maps to a distinct recovery
        strategy.
      </>
    ),
  },
  downloads: {
    type: "info",
    title: "Two download entry points",
    body: (
      <>
        <code>kunai --download -S &quot;Title&quot;</code> is a download-only bootstrap: resolve the
        title, queue downloads, exit - no shell queue UI. <code>/downloads</code> inside the running
        shell manages queued, running, and failed jobs. Do not confuse them.
      </>
    ),
  },
};

export function ScopeCallout({ variant = "beta", title, children }: ScopeCalloutProps) {
  const entry = copy[variant];
  return (
    <Callout type={entry.type} title={title ?? entry.title}>
      {children ?? entry.body}
    </Callout>
  );
}
