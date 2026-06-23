"use client";

import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-lg flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="kunai-type-caption">Something went wrong</p>
      <h1 className="kunai-type-title text-2xl">This page failed to load</h1>
      <p className="text-fd-muted-foreground text-sm text-pretty">
        Try again. If playback or provider docs were open, check{" "}
        <Link href="/docs/users/troubleshooting" className="text-fd-primary underline">
          troubleshooting
        </Link>{" "}
        or return to the docs home.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Button type="button" onClick={() => reset()}>
          Try again
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link href="/docs">Open docs home</Link>
        </Button>
      </div>
    </main>
  );
}
