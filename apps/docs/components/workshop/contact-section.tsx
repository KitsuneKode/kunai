import { contactChannels, GITHUB_PROFILE_URL, type ContactChannel } from "@/lib/contact";
import {
  IconArrowUpRight,
  IconBrandX,
  IconBug,
  IconMail,
  IconMessages,
  type Icon,
} from "@tabler/icons-react";

/**
 * "Say hello": who to write to, and which channel is for what.
 *
 * Four cards rather than a form. A form needs a backend the docs do not have, and
 * it collects an address and a message to hold somewhere, which this site
 * deliberately does not do. A link to a place that already exists collects
 * nothing. Each card says what the channel is for, so a visitor picks the right
 * one on the first try.
 */

/** Glyph per channel, so four near-identical cards can be told apart before a word is read. */
const GLYPH = {
  discussions: IconMessages,
  issues: IconBug,
  x: IconBrandX,
  email: IconMail,
} satisfies Record<ContactChannel["id"], Icon>;

function ChannelCard({ channel }: { readonly channel: ContactChannel }) {
  const Glyph = GLYPH[channel.id];
  const body = (
    <>
      <span className="flex items-center justify-between gap-2">
        <span className="text-fd-primary flex size-9 items-center justify-center rounded-lg bg-[color-mix(in_oklab,var(--kunai-accent)_12%,var(--kunai-surface))]">
          <Glyph className="size-[18px]" stroke={1.5} aria-hidden="true" />
        </span>
        <IconArrowUpRight
          aria-hidden="true"
          className="text-fd-muted-foreground size-4 transition-transform duration-150 ease-[var(--ease-out)] group-hover/channel:translate-x-0.5 group-hover/channel:-translate-y-0.5"
          stroke={1.5}
        />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-fd-foreground text-base font-medium">{channel.label}</span>
        <span className="text-fd-muted-foreground font-mono text-xs break-all">
          {channel.handle}
        </span>
      </span>
      <span className="text-fd-muted-foreground text-sm leading-6 text-pretty">
        {channel.useFor}
      </span>
    </>
  );
  const className =
    "group/channel border-fd-border bg-fd-card/60 hover:border-fd-primary flex h-full flex-col gap-4 rounded-xl border p-5 transition-[border-color,transform] duration-200 ease-[var(--ease-out)] active:scale-[0.98]";

  return channel.external ? (
    <a href={channel.href} target="_blank" rel="noreferrer noopener" className={className}>
      {body}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  ) : (
    <a href={channel.href} className={className}>
      {body}
    </a>
  );
}

export function ContactSection() {
  return (
    <section
      id="contact"
      aria-labelledby="contact-heading"
      className="flex scroll-mt-24 flex-col gap-6"
    >
      <div className="flex flex-col gap-3">
        <h2 id="contact-heading" className="kunai-type-title text-2xl">
          Say hello
        </h2>
        <p className="text-muted-foreground m-0 max-w-2xl text-sm leading-6 text-pretty">
          A question about Kunai, an idea, or something you are building. Public channels come
          first: an answer in a Discussion helps the next person who has the same question. The rest
          of the code lives on{" "}
          <a
            href={GITHUB_PROFILE_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="text-foreground underline underline-offset-4"
          >
            GitHub
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          .
        </p>
      </div>
      <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
        {contactChannels.map((channel) => (
          <li key={channel.id}>
            <ChannelCard channel={channel} />
          </li>
        ))}
      </ul>
    </section>
  );
}
