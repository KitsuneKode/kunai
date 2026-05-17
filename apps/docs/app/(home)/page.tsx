const sections = [
  {
    title: "Start",
    items: [
      {
        title: "Getting Started",
        href: "/docs/users/getting-started",
        description: "Install Kunai, check dependencies, and start playback safely.",
      },
      {
        title: "Platforms",
        href: "/docs/users/platforms",
        description: "Linux, macOS, Windows, source checkout, and optional tool notes.",
      },
      {
        title: "Commands And Shortcuts",
        href: "/docs/users/commands-and-shortcuts",
        description: "Palette commands, playback actions, overlays, and reporting shortcuts.",
      },
      {
        title: "Feature Tour",
        href: "/docs/users/feature-tour",
        description: "A compact map of the terminal-first playback experience.",
      },
    ],
  },
  {
    title: "Use",
    items: [
      {
        title: "Playback And Recovery",
        href: "/docs/users/playback-and-recovery",
        description: "Recover, replay, resume, fallback, and playback guardrails.",
      },
      {
        title: "Downloads And Offline",
        href: "/docs/users/downloads-and-offline",
        description: "Offline playback without mixing cache facts into user data.",
      },
    ],
  },
  {
    title: "Reliability",
    items: [
      {
        title: "Continue Watching And New Episodes",
        href: "/docs/users/continue-watching-and-new-episodes",
        description: "History reconciliation, release signals, and continuation shelves.",
      },
      {
        title: "Diagnostics And Reporting",
        href: "/docs/users/diagnostics-and-reporting",
        description: "Debug context that stays useful and privacy-safe.",
      },
      {
        title: "Reliability And Privacy",
        href: "/docs/users/reliability-and-privacy",
        description: "Release gates, storage boundaries, and safe support bundles.",
      },
    ],
  },
  {
    title: "Developer",
    items: [
      {
        title: "Debugging Workflow",
        href: "/docs/developer/debugging-workflow",
        description: "Trace playback, providers, diagnostics, storage, and release issues.",
      },
      {
        title: "Docs Maintenance",
        href: "/docs/developer/docs-maintenance",
        description: "Add pages, keep docs maintainable, and preserve Turbo build boundaries.",
      },
    ],
  },
];

export default function HomePage() {
  return (
    <main className="mx-auto w-[min(1120px,calc(100vw-40px))] py-18 max-md:w-[min(680px,calc(100vw-28px))] max-md:py-8">
      <section className="max-w-3xl pb-10">
        <p className="mb-3 text-xs font-extrabold tracking-[0.08em] text-[var(--kunai-accent)] uppercase">
          Kunai Docs
        </p>
        <h1 className="m-0 max-w-4xl text-[clamp(2.4rem,5vw,4.8rem)] leading-[1.05] font-black tracking-normal">
          Terminal streaming that stays explainable.
        </h1>
        <p className="text-fd-muted-foreground mt-5 max-w-2xl text-lg leading-8">
          Guides for using Kunai, debugging playback, and understanding the reliability boundaries
          that keep provider churn from corrupting user data.
        </p>
        <div className="border-fd-border bg-fd-card mt-7 grid gap-3 rounded-lg border p-4">
          <span className="text-fd-muted-foreground text-sm font-bold">Install</span>
          <code className="bg-fd-muted overflow-x-auto rounded-md px-3 py-2 text-sm">
            bun install -g @kitsunekode/kunai
          </code>
          <code className="bg-fd-muted overflow-x-auto rounded-md px-3 py-2 text-sm">
            kunai --setup
          </code>
        </div>
      </section>
      {sections.map((section) => (
        <section className="border-fd-border border-t py-8" key={section.title}>
          <h2 className="mb-5 text-2xl leading-tight font-extrabold tracking-normal">
            {section.title}
          </h2>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3.5">
            {section.items.map((item) => (
              <a
                className="border-fd-border bg-fd-card grid min-h-33 gap-2 rounded-lg border p-4.5 no-underline transition-colors hover:border-[var(--kunai-accent)]"
                href={item.href}
                key={item.href}
              >
                <span className="font-extrabold">{item.title}</span>
                <small className="text-fd-muted-foreground text-sm leading-6">
                  {item.description}
                </small>
              </a>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
