type HomeTerminalStaticProps = {
  readonly cliVersion: string;
  readonly publishedVersion?: string;
  readonly runtimeBaseline: { readonly bun: string; readonly mpv: string };
};

export function HomeTerminalStatic({
  cliVersion,
  publishedVersion,
  runtimeBaseline,
}: HomeTerminalStaticProps) {
  const versionBadge = publishedVersion ? `v${publishedVersion}` : `v${cliVersion} · next`;

  return (
    <div className="relative flex w-full items-center justify-center">
      <aside
        className="kunai-terminal-stage relative w-full overflow-hidden"
        aria-label="Kunai terminal preview"
      >
        <div className="kunai-terminal-top">
          <span className="kunai-window-dots" aria-hidden="true">
            <span className="kunai-window-dot kunai-window-dot--close" />
            <span className="kunai-window-dot kunai-window-dot--min" />
            <span className="kunai-window-dot kunai-window-dot--max" />
          </span>
          <span className="kunai-terminal-title">kunai — zsh</span>
          <span className="kunai-terminal-badges">
            <span className="tabular-nums">{versionBadge}</span>
            <span>simulated</span>
          </span>
        </div>

        <div className="kunai-terminal-body block h-[19rem] w-full text-left">
          <span className="kunai-log-line kunai-log-line--brand">▌ Kunai Shell {versionBadge}</span>
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
            <span className="kunai-text-accent mr-2 shrink-0 text-xs font-semibold whitespace-nowrap">
              kunai &gt;
            </span>
            <span className="text-fd-muted-foreground font-mono text-xs">
              Type &apos;/&apos; for commands…
            </span>
          </span>
        </div>
      </aside>
    </div>
  );
}
