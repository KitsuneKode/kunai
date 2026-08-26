import { CopyButton } from "@/components/ui/copy-button";
import { NATIVE_INSTALL_PS1, NATIVE_INSTALL_SH } from "@/lib/install-commands";
import { buildPageMetadata } from "@/lib/page-metadata";
import { catalogFor, initialFor, positionFor, titleFor } from "@/lib/share-presentation";
import {
  decodePlaybackTargetWebCode,
  encodePlaybackTargetRef,
  type ParsedKunaiShare,
  type PlaybackTargetRef,
} from "@kunai/types";
import { IconArrowRight, IconPlayerPlayFilled, IconTerminal2 } from "@tabler/icons-react";
import type { Metadata } from "next";
import Link from "next/link";

type SharePageProps = {
  readonly params: Promise<{ readonly code: string }>;
};

export async function generateMetadata({ params }: SharePageProps): Promise<Metadata> {
  const { code } = await params;
  const shared = decodePlaybackTargetWebCode(code);
  if (!shared) return { title: "Invalid share link", robots: { index: false, follow: false } };
  const title = titleFor(shared.ref);
  return {
    ...buildPageMetadata({
      title: `${title} — shared with Kunai`,
      description: `${positionFor(shared.ref)}. Open this catalog-anchored link in Kunai or install the terminal client.`,
      path: `/w/${code}`,
    }),
    robots: { index: false, follow: false },
  };
}

export default async function SharePage({ params }: SharePageProps) {
  const { code } = await params;
  const shared = decodePlaybackTargetWebCode(code);
  return shared ? <ValidShareLanding shared={shared} /> : <InvalidShareLanding />;
}

function ValidShareLanding({ shared }: { readonly shared: ParsedKunaiShare }) {
  const { ref, action } = shared;
  const title = titleFor(ref);
  const position = positionFor(ref);
  const appUrl = encodePlaybackTargetRef(ref, action);
  const catalog = catalogFor(ref);

  return (
    <main className="relative isolate flex min-h-[100dvh] items-center overflow-hidden px-5 py-10 sm:px-8">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_18%_20%,color-mix(in_oklab,var(--kunai-accent)_10%,transparent),transparent_34%),radial-gradient(circle_at_82%_82%,color-mix(in_oklab,var(--kunai-ok)_7%,transparent),transparent_32%)]"
      />
      <article className="kunai-surface-shell mx-auto w-full max-w-5xl p-2 shadow-2xl">
        <div className="kunai-surface-shell__inner grid min-h-[34rem] overflow-hidden lg:grid-cols-[0.78fr_1.22fr]">
          <div className="relative flex min-h-72 flex-col justify-between overflow-hidden border-b border-[var(--kunai-line)] bg-[var(--kunai-surface-elevated)] p-7 sm:p-10 lg:min-h-full lg:border-r lg:border-b-0">
            {shared.presentation?.posterUrl ? (
              <div
                aria-label={`Cover artwork for ${title}`}
                className="absolute inset-0 bg-cover bg-center opacity-30 grayscale-[0.18]"
                style={{ backgroundImage: `url(${JSON.stringify(shared.presentation.posterUrl)})` }}
              />
            ) : (
              <div
                aria-label={`Cover placeholder for ${title}`}
                className="absolute inset-0 grid place-items-center opacity-[0.07]"
              >
                <span className="font-serif text-[clamp(13rem,34vw,24rem)] leading-none font-semibold">
                  {initialFor(title)}
                </span>
              </div>
            )}
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-linear-to-t from-[var(--kunai-surface-elevated)] via-transparent to-[color-mix(in_oklab,var(--kunai-surface-elevated)_42%,transparent)]"
            />
            <div className="relative flex items-center justify-between gap-4">
              <span className="kunai-step-label">Shared through Kunai</span>
              <span className="rounded-full border border-[var(--kunai-line)] px-3 py-1 font-mono text-[0.65rem] tracking-[0.14em] text-[var(--color-fd-muted-foreground)] uppercase">
                {ref.kind}
              </span>
            </div>
            <div className="relative mt-24">
              <p className="mb-3 font-mono text-xs tracking-[0.12em] text-[var(--kunai-accent)] uppercase">
                {catalog}
              </p>
              <h1 className="max-w-md font-serif text-4xl leading-[1.04] font-semibold text-balance sm:text-5xl">
                {title}
              </h1>
              <p className="mt-5 text-sm font-medium text-[var(--kunai-ok)]">{position}</p>
            </div>
          </div>

          <div className="flex flex-col justify-between gap-10 p-7 sm:p-10 lg:p-12">
            <div>
              <p className="kunai-step-label">A direct handoff, not a search</p>
              <h2 className="mt-4 max-w-xl font-serif text-3xl leading-tight sm:text-4xl">
                Continue this exact title in your own player.
              </h2>
              <p className="mt-5 max-w-xl text-sm leading-7 text-[var(--color-fd-muted-foreground)]">
                The catalog and episode are carried in this link. Kunai resolves providers locally,
                then hands playback to mpv on your machine.
              </p>
              <a className="kunai-button kunai-button-primary mt-8 w-full sm:w-auto" href={appUrl}>
                <IconPlayerPlayFilled className="mr-2 size-4" aria-hidden="true" />
                {action === "download" ? "Open download in Kunai" : "Open in Kunai"}
              </a>
            </div>

            <section
              aria-labelledby="install-kunai"
              className="border-t border-[var(--kunai-line)] pt-8"
            >
              <div className="flex items-start gap-3">
                <IconTerminal2
                  className="mt-0.5 size-5 shrink-0 text-[var(--kunai-accent)]"
                  aria-hidden="true"
                />
                <div>
                  <h2 id="install-kunai" className="font-serif text-xl">
                    New to Kunai?
                  </h2>
                  <p className="mt-1 text-xs leading-6 text-[var(--color-fd-muted-foreground)]">
                    Install the native client, then return to this page and open the link again.
                  </p>
                </div>
              </div>
              <div className="mt-5 grid gap-3">
                <InstallCommand label="Linux / macOS" command={NATIVE_INSTALL_SH} />
                <InstallCommand label="Windows PowerShell" command={NATIVE_INSTALL_PS1} />
              </div>
              <p className="mt-5 text-xs leading-6 text-[var(--color-fd-muted-foreground)]">
                This page stores nothing and sends no share-page analytics. Anyone holding the URL
                can read the title it contains.{" "}
                <Link href="/docs/users/share-links">How sharing works</Link>
              </p>
            </section>
          </div>
        </div>
      </article>
    </main>
  );
}

function InstallCommand({ label, command }: { readonly label: string; readonly command: string }) {
  return (
    <div className="rounded-xl border border-[var(--kunai-line)] bg-[var(--kunai-bg)] p-3.5">
      <div className="mb-2 flex items-center justify-between gap-4">
        <span className="font-mono text-[0.65rem] tracking-[0.12em] text-[var(--color-fd-muted-foreground)] uppercase">
          {label}
        </span>
        <CopyButton text={command} label={`share-install-${label}`} />
      </div>
      <code className="block overflow-x-auto text-xs leading-6 whitespace-nowrap text-[var(--color-fd-foreground)]">
        {command}
      </code>
    </div>
  );
}

function InvalidShareLanding() {
  return (
    <main className="grid min-h-[100dvh] place-items-center px-5 py-10">
      <section className="kunai-surface-shell w-full max-w-xl p-2">
        <div className="kunai-surface-shell__inner p-8 sm:p-12">
          <p className="kunai-step-label text-[var(--kunai-danger)]">Link unavailable</p>
          <h1 className="mt-4 font-serif text-4xl leading-tight">This share link is incomplete.</h1>
          <p className="mt-5 text-sm leading-7 text-[var(--color-fd-muted-foreground)]">
            It may have been truncated while copying. Ask the sender for the complete HTTPS link;
            Kunai will never guess a title from a damaged code.
          </p>
          <Link className="kunai-button mt-8" href="/">
            Kunai home <IconArrowRight className="ml-2 size-4" aria-hidden="true" />
          </Link>
        </div>
      </section>
    </main>
  );
}
