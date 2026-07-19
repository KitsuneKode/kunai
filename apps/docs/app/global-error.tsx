"use client";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="bg-fd-background text-fd-foreground flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center antialiased">
        <p className="text-xs font-semibold tracking-widest text-[var(--kunai-accent)] uppercase">
          Kunai Docs
        </p>
        <h1 className="text-2xl font-light">The docs site hit an unexpected error</h1>
        <p className="text-fd-muted-foreground max-w-md text-sm">
          {error.message || "Reload the page or head back to the documentation home."}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button type="button" onClick={() => reset()}>
            Reload
          </Button>
          <Link href="/" className={cn(buttonVariants({ variant: "outline" }))}>
            Go home
          </Link>
        </div>
      </body>
    </html>
  );
}
