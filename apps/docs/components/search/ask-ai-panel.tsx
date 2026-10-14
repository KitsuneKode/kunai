"use client";

import { askAi } from "@/lib/ask-ai";
import type { AnswerSession } from "@oramacloud/client";
import { useRef, useState } from "react";

type AskAiPanelProps = {
  readonly initialQuery: string;
  readonly onBack: () => void;
};

type Source = { readonly title?: string; readonly url?: string };

type SourcesRef = { current: Source[] };

type AskState =
  | { readonly phase: "idle" }
  | { readonly phase: "asking" }
  | { readonly phase: "answered"; readonly answer: string; readonly sources: readonly Source[] }
  | { readonly phase: "error"; readonly message: string };

/**
 * The opt-in AI answer view inside search. Everything here is a third-party
 * round trip, and the component makes that visible at the exact moment it
 * happens — the disclaimer sits above the ask button, not in a footer page
 * somewhere. Nothing is sent until the visitor asks; the SDK itself is
 * `await import()`ed here so it never ships to anyone who only searches.
 */
export function AskAiPanel({ initialQuery, onBack }: AskAiPanelProps) {
  const [question, setQuestion] = useState(initialQuery);
  const [state, setState] = useState<AskState>({ phase: "idle" });
  const sessionRef = useRef<AnswerSession<boolean> | null>(null);
  const sourcesRef: SourcesRef = useRef<Source[]>([]);

  if (!askAi) return null;
  const config = askAi;

  const ask = async () => {
    const term = question.trim();
    if (!term || state.phase === "asking") return;
    setState({ phase: "asking" });
    try {
      // Loaded on first ask, not at module scope — the client is ~150KB and a
      // visitor who never opens this panel should never pay for it.
      const { OramaClient } = await import("@oramacloud/client");
      if (!sessionRef.current) {
        const client = new OramaClient({
          endpoint: config.endpoint,
          api_key: config.publicKey,
          // Only the question should leave the device — not Orama's own usage
          // collector on top of it.
          telemetry: false,
          cache: false,
        });
        sessionRef.current = client.createAnswerSession({
          events: {
            onSourceChange: (results) => {
              sourcesRef.current = (results?.hits ?? []).map((hit) => {
                const doc = hit.document as { title?: string; url?: string };
                return { title: doc.title, url: doc.url };
              });
            },
          },
        });
      }
      sourcesRef.current = [];
      const answer = await sessionRef.current.ask({ term });
      setState({
        phase: "answered",
        answer: typeof answer === "string" ? answer : String(answer),
        sources: sourcesRef.current,
      });
    } catch (error) {
      setState({
        phase: "error",
        message: error instanceof Error ? error.message : "The answer request failed.",
      });
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4 text-sm">
      <p className="text-fd-muted-foreground m-0 text-xs leading-relaxed">
        Answers by {config.providerLabel}, an external service — your question is sent to{" "}
        {config.providerLabel}&apos;s servers when you ask. Document search stays on this device.
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void ask();
          }}
          placeholder="Ask the docs a question…"
          aria-label="Ask the docs a question"
          className="bg-fd-background text-fd-foreground border-input min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-2"
        />
        <button
          type="button"
          onClick={() => void ask()}
          disabled={state.phase === "asking" || question.trim().length === 0}
          className="bg-fd-primary text-fd-primary-foreground shrink-0 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          {state.phase === "asking" ? "Asking…" : "Ask"}
        </button>
      </div>

      {/* aria-live is on the always-mounted wrapper: a region that appears
          already filled is missed by some readers, one that fills after it
          exists is announced every time. */}
      <div aria-live="polite">
        {state.phase === "answered" && (
          <div className="flex flex-col gap-2">
            <p className="m-0 leading-relaxed whitespace-pre-wrap">{state.answer}</p>
            {state.sources.length > 0 && (
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {state.sources.map((source) => (
                  <li key={source.url ?? source.title} className="text-xs">
                    {source.url ? (
                      <a
                        href={source.url}
                        className="text-fd-primary underline-offset-4 hover:underline"
                      >
                        {source.title || source.url}
                      </a>
                    ) : (
                      <span className="text-fd-muted-foreground">{source.title}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {state.phase === "error" && (
        <p className="text-fd-destructive m-0 text-xs" role="alert">
          {state.message} Nothing was cached or retried — ask again if you want to retry.
        </p>
      )}

      <button
        type="button"
        onClick={onBack}
        className="text-fd-muted-foreground hover:text-fd-foreground self-start text-xs underline-offset-4 hover:underline"
      >
        Back to search
      </button>
    </div>
  );
}
