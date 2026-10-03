import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { SPONSOR_URL, type Sponsor } from "@/lib/support";
import { IconHeart } from "@tabler/icons-react";
import Link from "next/link";

/**
 * The people who back Kunai, by name.
 *
 * Takes the list as a prop rather than importing it, so the empty state and the
 * populated state can both be rendered and tested without editing the real
 * list. Empty is the true state at launch, and an empty wall that explains
 * itself and offers the one action that fills it is better than a section that
 * quietly isn't there.
 */
export function SponsorWall({ sponsors }: { readonly sponsors: readonly Sponsor[] }) {
  if (sponsors.length === 0) {
    return (
      <Empty className="border-border bg-card/40 border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconHeart />
          </EmptyMedia>
          <EmptyTitle>No sponsors yet</EmptyTitle>
          <EmptyDescription className="max-w-md text-pretty">
            The first sponsor gets this page to themselves. Names appear here only when a sponsor
            says they want to be listed.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            size="sm"
            render={<Link href={SPONSOR_URL} target="_blank" rel="noreferrer noopener" />}
            nativeButton={false}
          >
            Be the first
            <span className="sr-only"> (opens GitHub Sponsors in a new tab)</span>
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
      {sponsors.map((sponsor) => (
        <li key={sponsor.name}>
          {sponsor.url ? (
            <a
              href={sponsor.url}
              target="_blank"
              rel="noreferrer noopener"
              className="border-border bg-card hover:border-primary inline-flex items-center rounded-lg border px-3 py-1.5 text-sm transition-[border-color] duration-150"
            >
              {sponsor.name}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            <span className="border-border bg-card inline-flex items-center rounded-lg border px-3 py-1.5 text-sm">
              {sponsor.name}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
