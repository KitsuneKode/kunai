import { Step, Steps } from "fumadocs-ui/components/steps";

export function QuickStartSteps() {
  return (
    <Steps>
      <Step>
        <h3 className="text-fd-foreground m-0 font-serif text-lg font-medium">
          Install dependencies
        </h3>
        <p className="text-fd-muted-foreground mt-2 text-sm leading-relaxed">
          Install <strong>Bun</strong> and <strong>mpv</strong>. Optional: <code>yt-dlp</code>,{" "}
          <code>ffprobe</code>, <code>chafa</code> for downloads, validation, and poster previews.
          Run <code>kunai --setup</code> to see what Kunai detected on your machine.
        </p>
      </Step>
      <Step>
        <h3 className="text-fd-foreground m-0 font-serif text-lg font-medium">Install Kunai</h3>
        <p className="text-fd-muted-foreground mt-2 text-sm leading-relaxed">
          During beta the supported path is <code>bun install -g @kitsunekode/kunai</code>. Source
          contributors use <code>bun run link:global</code> from the repository checkout.
        </p>
      </Step>
      <Step>
        <h3 className="text-fd-foreground m-0 font-serif text-lg font-medium">
          Launch with intent
        </h3>
        <p className="text-fd-muted-foreground mt-2 text-sm leading-relaxed">
          Start with <code>kunai -S &quot;Dune&quot;</code> or{" "}
          <code>kunai -a -S &quot;Frieren&quot;</code>. Search shows results — it does not auto-play
          unless you add <code>--jump</code> or <code>-q</code>.
        </p>
      </Step>
      <Step>
        <h3 className="text-fd-foreground m-0 font-serif text-lg font-medium">
          Learn recovery early
        </h3>
        <p className="text-fd-muted-foreground mt-2 text-sm leading-relaxed">
          Press <code>/</code> for the palette. If playback stalls: <code>/recover</code> refreshes
          the current provider, <code>/fallback</code> tries the next compatible provider,{" "}
          <code>/diagnostics</code> shows evidence.
        </p>
      </Step>
    </Steps>
  );
}
