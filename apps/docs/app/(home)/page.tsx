import { homeHero, homeHighlights, homeSections } from "../../lib/home-content";

export default function HomePage() {
  return (
    <main className="mx-auto w-[min(1180px,calc(100vw-40px))] py-14 max-md:w-[min(720px,calc(100vw-28px))] max-md:py-8">
      <section className="border-fd-border grid min-h-[calc(100vh-9rem)] grid-cols-[minmax(0,1.05fr)_minmax(340px,0.65fr)] items-center gap-10 border-b pb-10 max-lg:min-h-0 max-lg:grid-cols-1">
        <div>
          <p className="mb-3 text-xs font-extrabold tracking-[0.08em] text-[var(--kunai-accent)] uppercase">
            {homeHero.eyebrow}
          </p>
          <h1 className="m-0 max-w-4xl text-[clamp(2.55rem,6vw,5.65rem)] leading-[0.98] font-black tracking-normal">
            {homeHero.title}
          </h1>
          <p className="text-fd-muted-foreground mt-6 max-w-2xl text-lg leading-8">
            {homeHero.description}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a className="kunai-button kunai-button-primary" href={homeHero.primaryCta.href}>
              {homeHero.primaryCta.label}
            </a>
            <a className="kunai-button" href={homeHero.secondaryCta.href}>
              {homeHero.secondaryCta.label}
            </a>
          </div>
        </div>
        <aside className="border-fd-border bg-fd-card border p-5 shadow-sm">
          <span className="text-fd-muted-foreground text-sm font-extrabold">Install</span>
          <div className="mt-3 grid gap-2">
            {homeHero.installCommands.map((command) => (
              <code
                className="bg-fd-muted overflow-x-auto rounded-md px-3 py-2 text-sm"
                key={command}
              >
                {command}
              </code>
            ))}
          </div>
          <div className="border-fd-border mt-5 grid gap-3 border-t pt-5">
            {homeHighlights.map((item) => (
              <div key={item.label}>
                <p className="m-0 text-sm font-extrabold">{item.label}</p>
                <p className="text-fd-muted-foreground m-0 mt-1 text-sm leading-6">{item.detail}</p>
              </div>
            ))}
          </div>
        </aside>
      </section>
      {homeSections.map((section) => (
        <section
          className="border-fd-border grid grid-cols-[220px_minmax(0,1fr)] gap-8 border-b py-10 max-md:grid-cols-1 max-md:gap-4"
          key={section.title}
        >
          <div>
            <p className="m-0 text-xs font-extrabold tracking-[0.08em] text-[var(--kunai-accent)] uppercase">
              {section.eyebrow}
            </p>
            <h2 className="m-0 mt-2 text-3xl leading-tight font-extrabold tracking-normal">
              {section.title}
            </h2>
            <p className="text-fd-muted-foreground m-0 mt-3 text-sm leading-6">
              {section.description}
            </p>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-3.5">
            {section.items.map((item) => (
              <a
                className="kunai-doc-card border-fd-border bg-fd-card grid min-h-34 gap-2 border p-4.5 no-underline transition-colors hover:border-[var(--kunai-accent)]"
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
