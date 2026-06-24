import { Step, Steps } from "fumadocs-ui/components/steps";
import Link from "next/link";

export function QuickStartSteps() {
  return (
    <Steps>
      <Step>
        <h3 className="text-fd-foreground m-0 font-serif text-lg font-medium">
          Install Kunai and mpv
        </h3>
        <p className="text-fd-muted-foreground mt-2 text-sm leading-relaxed">
          Fastest path: run the release installer (<code>install.sh</code> on Linux/macOS,{" "}
          <code>install.ps1</code> on Windows). It bundles Bun and links <code>kunai</code> on your
          PATH. You still need <code>mpv</code> for playback. See{" "}
          <Link href="/docs/users/install-and-update">Install and update</Link> for package and
          source options.
        </p>
      </Step>
      <Step>
        <h3 className="text-fd-foreground m-0 font-serif text-lg font-medium">Run setup once</h3>
        <p className="text-fd-muted-foreground mt-2 text-sm leading-relaxed">
          <code>kunai --setup</code> checks dependencies, writes config under{" "}
          <code>~/.config/kunai/</code>, and explains any optional tools that are missing (
          <code>yt-dlp</code>, <code>chafa</code>, and others).
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
