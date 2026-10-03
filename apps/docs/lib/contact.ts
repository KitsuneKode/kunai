import { docsGithubIssuesUrl } from "./docs-github";

/**
 * Where to reach the maintainer, in one place.
 *
 * Every entry is a channel that exists and is already public: the GitHub profile
 * lists the X handle and the email, and Discussions is enabled on the repository.
 * Nothing here is invented, and nothing private is published. Add or remove a
 * channel by editing this list; the `/workshop` page and its tests read it.
 *
 * Public channels come first on purpose. A question answered in a Discussion
 * helps the next person who has it, where an email helps one.
 */

export type ContactChannel = {
  readonly id: "discussions" | "issues" | "x" | "email";
  readonly label: string;
  /** What is shown as the address of the channel. */
  readonly handle: string;
  readonly href: string;
  /** What this channel is for, so nobody has to guess which one to use. */
  readonly useFor: string;
  /** Opens in a new tab. `mailto:` does not. */
  readonly external: boolean;
};

export const GITHUB_PROFILE_URL = "https://github.com/KitsuneKode";

/** The email the GitHub profile publishes. */
export const CONTACT_EMAIL = "bhuyanmanash2002@gmail.com";

export const contactChannels: readonly ContactChannel[] = [
  {
    id: "discussions",
    label: "GitHub Discussions",
    handle: "KitsuneKode/kunai",
    href: "https://github.com/KitsuneKode/kunai/discussions",
    useFor: "Questions, ideas and show-and-tell. Public, so the answer helps the next person.",
    external: true,
  },
  {
    id: "issues",
    label: "Report a problem",
    handle: "GitHub issues",
    href: docsGithubIssuesUrl(),
    useFor: "A broken provider, a bug, or a guide that was wrong. Include what you saw.",
    external: true,
  },
  {
    id: "x",
    label: "X",
    handle: "@KitsuneKode",
    href: "https://x.com/KitsuneKode",
    useFor: "A quick message, or a conversation about something built here.",
    external: true,
  },
  {
    id: "email",
    label: "Email",
    handle: CONTACT_EMAIL,
    href: `mailto:${CONTACT_EMAIL}`,
    useFor: "Anything that should not be in a public thread.",
    external: false,
  },
];
