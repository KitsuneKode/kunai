type HomeTerminalStaticProps = {
  readonly cliVersion: string;
  readonly runtimeBaseline: { readonly bun: string; readonly mpv: string };
};

/**
 * The server-rendered terminal preview.
 *
 * The interactive simulator is loaded with `ssr: false`, so nothing inside it
 * reaches the initial HTML — which meant the only place on this page that named
 * anime, series, or movies was invisible to crawlers and to anyone reading
 * before hydration. This renders the same frame, with the same classes, holding
 * a real result set. The simulator swaps itself in on mount.
 *
 * It is also what a visitor with JavaScript disabled now gets instead of a
 * pulsing empty box.
 */
export function HomeTerminalStatic({ cliVersion, runtimeBaseline }: HomeTerminalStaticProps) {
  return (
    <div className="relative flex w-full items-center justify-center">
      <div className="kunai-hero-glow" aria-hidden="true" />

      <aside
        className="kunai-terminal-stage relative w-full overflow-hidden"
        aria-label="Kunai terminal preview"
      >
        <div className="kunai-terminal-top">
          <span className="text-fd-muted-foreground flex items-center gap-1.5 text-xs">
            <span className="kunai-status-dot kunai-status-dot--focus" />
            kunai shell
          </span>
          <span className="kunai-terminal-badges">
            <span className="kunai-step-meta tabular-nums">v{cliVersion}</span>
            <span className="kunai-step-meta">simulated</span>
          </span>
        </div>

        <div className="kunai-terminal-body scrollbar block max-h-[360px] min-h-[260px] w-full text-left">
          <span className="kunai-log-line kunai-log-line--brand">▌ Kunai Shell v{cliVersion}</span>
          <span className="kunai-log-line kunai-log-line--muted">
            Requires mpv {runtimeBaseline.mpv}. The binary install embeds bun {runtimeBaseline.bun}.
          </span>
          <span className="kunai-log-line kunai-log-line--query">
            [QUERY] searching 7 providers…
          </span>
          <span className="kunai-log-line kunai-log-line--muted">
            {"  1. Frieren: Beyond Journey's End (Series) [Anime]"}
          </span>
          <span className="kunai-log-line kunai-log-line--muted">
            {"  2. Dune: Part Two (Movie) [Sci-Fi]"}
          </span>
          <span className="kunai-log-line kunai-log-line--muted">
            {"  3. Erased (Series) [Mystery]"}
          </span>
          <span className="kunai-log-line kunai-log-line--play">[PLAY] handing stream to mpv</span>

          <span className="kunai-terminal-input-row">
            <span className="kunai-text-accent mr-2 text-xs font-bold">kunai &gt;</span>
            <span className="text-fd-muted-foreground font-mono text-xs">
              Type &apos;/&apos; for commands…
            </span>
          </span>
        </div>
      </aside>
    </div>
  );
}
