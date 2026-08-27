import { KunaiFoxBanner } from "@/components/brand/kunai-fox-banner";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[70dvh] w-[min(720px,calc(100vw-32px))] flex-col items-start justify-center gap-6 py-16">
      <KunaiFoxBanner
        pose="watch"
        heading="h1"
        eyebrow="404"
        title="This page is not in the docs tree."
      >
        The route may have moved, or the guide may still be unpublished. Start from the home page or
        open the documentation hub.
      </KunaiFoxBanner>
      <div className="flex flex-wrap gap-3">
        <Link className="kunai-button kunai-button-primary" href="/">
          Back to home
        </Link>
        <Link className="kunai-button" href="/docs">
          Documentation
        </Link>
      </div>
    </main>
  );
}
