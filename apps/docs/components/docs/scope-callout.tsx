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
    title: "Beta scope (read this first)",
    body: (
      <>
        Kunai is a terminal-first CLI during beta. The default install is a release binary (
        <code>install.sh</code> / <code>install.ps1</code>) that bundles Bun — you do not need a
        separate Bun install to run it. Global package installs and source checkouts still require{" "}
        <strong>Bun</strong> and <strong>mpv</strong> on your PATH. Kunai does not host media — it
        resolves streams from third-party providers on your machine and hands playback to mpv.
        Provider availability changes; recovery commands exist because drift is expected.
      </>
    ),
  },
  privacy: {
    type: "idea",
    title: "Privacy by default",
    body: (
      <>
        Watch history and playlists are durable local data. Stream URLs, provider caches, and trace
        rows are disposable. Exported diagnostics are redacted — no raw stream URLs, auth tokens, or
        private home paths in support bundles unless you paste them yourself.
      </>
    ),
  },
  providers: {
    type: "warn",
    title: "Third-party providers",
    body: (
      <>
        Kunai scrapes direct-provider endpoints locally. It does not operate streaming
        infrastructure, guarantee catalog completeness, or bypass DRM. When a provider fails, use{" "}
        <code>/recover</code>, then <code>/fallback</code>, then <code>/diagnostics</code> — each
        command maps to a distinct recovery strategy.
      </>
    ),
  },
  downloads: {
    type: "info",
    title: "Two download entry points",
    body: (
      <>
        <code>kunai --download -S &quot;Title&quot;</code> is a download-only bootstrap: resolve the
        title, queue downloads, exit — no shell queue UI. <code>/downloads</code> inside the running
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
