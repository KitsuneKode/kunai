import { SPONSOR_URL, SUPPORT_PATH } from "@/lib/support";
import { IconHeart } from "@tabler/icons-react";
import Link from "next/link";

/**
 * One quiet ask, after the reasons and before the last install prompt.
 *
 * It states what the money is for in a sentence, because "support the project"
 * with no object is a button people scroll past. The free ways to help live on
 * `/support`, one click further, so this strip stays a single decision.
 */
export function HomeSupportStrip() {
  return (
    <section
      aria-labelledby="home-support-title"
      className="kunai-home-support border-fd-border flex flex-col gap-5 border-t py-10 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex max-w-2xl flex-col gap-1.5">
        <h2
          id="home-support-title"
          className="text-fd-foreground m-0 font-sans text-lg font-medium"
        >
          Kunai is free, and someone has to keep up with the providers.
        </h2>
        <p className="text-fd-muted-foreground m-0 text-sm leading-6 text-pretty">
          Providers change their keys and layouts regularly. Sponsorship pays for the time it takes
          to keep playback working.
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <a
          className="kunai-button kunai-button-primary"
          href={SPONSOR_URL}
          rel="noreferrer noopener"
          target="_blank"
        >
          <IconHeart className="mr-1.5 size-4" stroke={1.5} />
          <span>Sponsor</span>
          <span className="sr-only"> (opens GitHub Sponsors in a new tab)</span>
        </a>
        <Link className="kunai-button kunai-button-quiet" href={SUPPORT_PATH}>
          Other ways to help
        </Link>
      </div>
    </section>
  );
}
