import { NATIVE_INSTALL_PS1, NATIVE_INSTALL_SH } from "@/lib/install-commands";
import { Step, Steps } from "fumadocs-ui/components/steps";
import Link from "next/link";

export function QuickStartSteps() {
  return (
    <Steps>
      <Step>
        <h3 className="text-fd-foreground m-0 text-lg font-medium">Install the binary</h3>
        <p className="text-fd-muted-foreground mt-2 text-sm leading-relaxed">
          Preferred path (self-contained binary — no Bun or Node required). Bootstrap script differs
          by OS:
        </p>
        <pre className="bg-fd-secondary text-fd-foreground mt-2 overflow-x-auto rounded-lg p-3 text-sm">
          <code>
            {`# Linux / macOS
${NATIVE_INSTALL_SH}

# Windows (PowerShell)
${NATIVE_INSTALL_PS1}

kunai --version`}
          </code>
        </pre>
        <p className="text-fd-muted-foreground mt-2 text-sm leading-relaxed">
          Bun/npm globals and source checkouts are secondary. See{" "}
          <Link href="/docs/users/install-and-update">Install and update</Link> for those channels.
        </p>
      </Step>
      <Step>
        <h3 className="text-fd-foreground m-0 text-lg font-medium">Confirm mpv, then run setup</h3>
        <p className="text-fd-muted-foreground mt-2 text-sm leading-relaxed">
          Playback needs <code>mpv</code> on your <code>PATH</code>. Setup and browsing still work
          when mpv is missing — only committed playback startup requires it.
        </p>
        <pre className="bg-fd-secondary text-fd-foreground mt-2 overflow-x-auto rounded-lg p-3 text-sm">
          <code>
            {`mpv --version
kunai --setup`}
          </code>
        </pre>
      </Step>
      <Step>
        <h3 className="text-fd-foreground m-0 text-lg font-medium">Search and pick a title</h3>
        <p className="text-fd-muted-foreground mt-2 text-sm leading-relaxed">
          Start with <code>kunai -S &quot;Dune&quot;</code>. Select a result, choose an episode when
          needed, let Kunai resolve a provider stream, then confirm mpv startup. Search shows
          results — it does not auto-play unless you add <code>--jump</code> or <code>-q</code>.
        </p>
      </Step>
      <Step>
        <h3 className="text-fd-foreground m-0 text-lg font-medium">Learn recovery early</h3>
        <p className="text-fd-muted-foreground mt-2 text-sm leading-relaxed">
          Press <code>/</code> for the palette. If playback stalls: <code>/recover</code> refreshes
          the current provider, <code>/fallback</code> tries the next compatible provider,{" "}
          <code>/diagnostics</code> shows evidence.
        </p>
      </Step>
    </Steps>
  );
}
