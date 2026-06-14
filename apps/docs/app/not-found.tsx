import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[70dvh] w-[min(720px,calc(100vw-32px))] flex-col items-start justify-center gap-6 py-16">
      <p className="text-fd-primary text-[11px] font-bold tracking-[0.14em] uppercase">404</p>
      <h1 className="text-fd-foreground m-0 max-w-lg font-serif text-5xl leading-[1.02] font-light tracking-tight">
        This page is not in the docs tree.
      </h1>
      <p className="text-fd-muted-foreground max-w-xl text-sm leading-relaxed">
        The route may have moved, or the guide may still be unpublished. Start from the home page or
        open the documentation hub.
      </p>
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
