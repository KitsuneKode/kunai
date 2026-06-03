import {
  homeFlow,
  homeHero,
  homeHighlights,
  homeProof,
  homeSections,
} from "../../lib/home-content";

export default function HomePage() {
  return (
    <main className="kunai-home mx-auto w-[min(1400px,calc(100vw-32px))] overflow-x-hidden py-8 max-md:w-[min(760px,calc(100vw-20px))]">
      <section className="kunai-hero grid min-h-[calc(100dvh-8rem)] grid-cols-[minmax(0,1.02fr)_minmax(360px,0.78fr)] items-center gap-12 pb-18 max-lg:min-h-0 max-lg:grid-cols-1 max-lg:pt-10">
        <div className="kunai-reveal">
          <p className="kunai-eyebrow">{homeHero.eyebrow}</p>
          <h1 className="m-0 max-w-5xl text-6xl leading-[0.9] font-black tracking-normal text-balance md:text-7xl xl:text-8xl">
            {homeHero.title}
          </h1>
          <p className="text-fd-muted-foreground mt-7 max-w-2xl text-lg leading-8 text-pretty">
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

        <aside
          className="kunai-terminal-stage kunai-reveal kunai-reveal-late"
          aria-label="Kunai terminal preview"
        >
          <div className="kunai-terminal-top">
            <span>kunai</span>
            <span>anime mode</span>
            <span>provider checked</span>
          </div>
          <div className="kunai-terminal-body">
            <p>
              <span className="kunai-accent">▌</span> Frieren S01E08
            </p>
            <p>
              <span className="kunai-ok">ready for you now</span>{" "}
              <span className="kunai-muted">source verified</span>
            </p>
            <p className="kunai-gap">MISSION&nbsp;&nbsp;Hand off to mpv</p>
            <p>
              <span className="kunai-ok">●</span> Provider&nbsp;&nbsp;AllAnime
            </p>
            <p>
              <span className="kunai-accent">●</span> Stream&nbsp;&nbsp;&nbsp;&nbsp;1080p selected
            </p>
            <p>
              <span className="kunai-muted">○</span> Subs&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;eng
              pending
            </p>
            <p className="kunai-gap">
              <span className="kunai-muted">/ commands</span>&nbsp;&nbsp;n next&nbsp;&nbsp;r
              recover&nbsp;&nbsp;f fallback
            </p>
          </div>
          <div className="kunai-install">
            <span>Install</span>
            {homeHero.installCommands.map((command) => (
              <code key={command}>{command}</code>
            ))}
          </div>
        </aside>
      </section>

      <section className="kunai-band">
        <div>
          <p className="kunai-eyebrow">Experience promise</p>
          <h2>Designed for the moment the provider does not behave.</h2>
        </div>
        <div className="kunai-highlight-grid">
          {homeHighlights.map((item) => (
            <article className="kunai-highlight" key={item.label}>
              <span>{item.label}</span>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="kunai-flow-section">
        <div className="kunai-section-head">
          <p className="kunai-eyebrow">Playback path</p>
          <h2>One readable path from intent to recovery.</h2>
        </div>
        <div className="kunai-flow">
          {homeFlow.map((step, index) => (
            <article className={`kunai-flow-card kunai-state-${step.state}`} key={step.title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="kunai-docs-section">
        <div className="kunai-section-head">
          <p className="kunai-eyebrow">Docs map</p>
          <h2>Pick the guide by the job in front of you.</h2>
        </div>
        <div className="grid gap-5">
          {homeSections.map((section) => (
            <section className="kunai-doc-row" key={section.title}>
              <div>
                <p className="kunai-eyebrow">{section.eyebrow}</p>
                <h3>{section.title}</h3>
                <p>{section.description}</p>
              </div>
              <div className="kunai-doc-links">
                {section.items.map((item) => (
                  <a className="kunai-doc-card" href={item.href} key={item.href}>
                    <span>{item.title}</span>
                    <small>{item.description}</small>
                  </a>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>

      <section className="kunai-proof-section">
        <div className="kunai-section-head">
          <p className="kunai-eyebrow">Reliability posture</p>
          <h2>Useful feedback without leaking private runtime state.</h2>
        </div>
        <div className="kunai-proof-grid">
          {homeProof.map((item) => (
            <article className="kunai-proof" key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="kunai-final">
        <div>
          <p className="kunai-eyebrow">Start here</p>
          <h2>Install once. Keep playback explainable.</h2>
        </div>
        <div className="flex flex-wrap gap-3">
          <a className="kunai-button kunai-button-primary" href={homeHero.primaryCta.href}>
            {homeHero.primaryCta.label}
          </a>
          <a className="kunai-button" href="/docs/users/diagnostics-and-reporting">
            Debug a session
          </a>
        </div>
      </section>
    </main>
  );
}
