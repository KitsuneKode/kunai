import Link from "next/link";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const MARKDOWN_COMPONENTS: Components = {
  p: ({ children }) => <p className="m-0">{children}</p>,
  strong: ({ children }) => (
    <strong className="text-fd-foreground font-semibold">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ children, className: codeClass }) => {
    const text = String(children);
    if (codeClass || text.includes("\n")) {
      return (
        <code className="bg-fd-muted text-fd-foreground block overflow-x-auto rounded-md p-3 font-mono text-xs">
          {text}
        </code>
      );
    }
    return (
      <code className="bg-fd-muted text-fd-foreground rounded px-1 py-0.5 font-mono text-[0.85em]">
        {text}
      </code>
    );
  },
  a: ({ href, children }) => {
    if (href?.startsWith("kunai://")) {
      return (
        <>
          {children}{" "}
          <code className="bg-fd-muted text-fd-foreground rounded px-1 py-0.5 font-mono text-[0.85em]">
            {href}
          </code>
        </>
      );
    }
    const external = href?.startsWith("http");
    return external ? (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-fd-primary underline-offset-4 hover:underline"
      >
        {children}
      </a>
    ) : (
      <Link href={href ?? "#"} className="text-fd-primary underline-offset-4 hover:underline">
        {children}
      </Link>
    );
  },
  ul: ({ children }) => <ul className="mt-2 grid list-disc gap-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="mt-2 grid list-decimal gap-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="pl-1">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-fd-border text-fd-muted-foreground border-l-2 pl-3 italic">
      {children}
    </blockquote>
  ),
  h1: ({ children }) => <span className="mt-2 block font-semibold">{children}</span>,
  h2: ({ children }) => <span className="mt-2 block font-semibold">{children}</span>,
  h3: ({ children }) => <span className="mt-2 block font-semibold">{children}</span>,
  h4: ({ children }) => <span className="mt-2 block font-semibold">{children}</span>,
  hr: () => <hr className="border-fd-border my-3" />,
  pre: ({ children }) => <>{children}</>,
};

/**
 * Renders a bounded markdown string (release notes, changelog bodies) with the
 * site's typography. Not a general MDX path — GFM only, external links open in
 * a new tab, and `kunai://` handoff URLs render as code since a docs page
 * can't hand one to a terminal anyway.
 */
export function MarkdownText({ children }: { readonly children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={MARKDOWN_COMPONENTS}
      // The default transform strips unknown protocols to `""` before the `a`
      // renderer runs — keep `kunai:` intact so it can render as code instead.
      urlTransform={(url) => (url.startsWith("kunai:") ? url : defaultUrlTransform(url))}
    >
      {children}
    </ReactMarkdown>
  );
}
