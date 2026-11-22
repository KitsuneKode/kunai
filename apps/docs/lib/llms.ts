import { codeMetadata } from "@/lib/code-metadata";
import { docsEditUrl } from "@/lib/docs-github";
import {
  BUN_GLOBAL_INSTALL,
  CANONICAL_SETUP,
  FIRST_SEARCH,
  MPV_VERSION_CHECK,
  NATIVE_INSTALL_PS1,
  NATIVE_INSTALL_SH,
  NPM_GLOBAL_INSTALL,
  VERSION_CHECK,
} from "@/lib/install-commands";
import { docsCanonicalUrl, docsSiteUrl } from "@/lib/site";
import { source } from "@/lib/source";

type DocsPageItem = NonNullable<ReturnType<typeof source.getPage>>;

function escapePipe(value: string): string {
  return value.replaceAll("|", "\\|").replace(/\r?\n/g, " ").trim();
}

function renderCliFlagsMarkdown(): string {
  const rows = codeMetadata.cliOptions.map(
    (opt) => `| \`${opt.short || "—"}\` | \`${opt.long}\` | ${escapePipe(opt.description)} |`,
  );
  return ["| Short | Flag | Description |", "| --- | --- | --- |", ...rows].join("\n");
}

function renderProvidersMarkdown(): string {
  const rows = codeMetadata.providers.map(
    (p) =>
      `| \`${p.id}\` | ${escapePipe(p.displayName)} | ${p.mediaKinds.join(", ")} | ${p.recommended ? "Yes" : "No"} | ${escapePipe(p.description)} |`,
  );
  return [
    "| ID | Provider | Media kinds | Recommended | Description |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

function renderCommandsMarkdown(): string {
  const rows = codeMetadata.commands.map(
    (cmd) =>
      `| \`/${cmd.id}\` | ${cmd.aliases.map((a) => `\`/${a}\``).join(", ") || "—"} | ${escapePipe(cmd.description)} |`,
  );
  return ["| Command | Aliases | Description |", "| --- | --- | --- |", ...rows].join("\n");
}

function renderShortcutsMarkdown(): string {
  const rows = [...codeMetadata.shortcuts]
    .sort((a, b) => a.order - b.order)
    .map((s) => `| \`${escapePipe(s.keys)}\` | ${escapePipe(s.scope)} | ${escapePipe(s.label)} |`);
  return ["| Keys | Scope | Action |", "| --- | --- | --- |", ...rows].join("\n");
}

function renderFeatureStatusMarkdown(): string {
  const rows = codeMetadata.featureStatus.map(
    (f) => `| ${escapePipe(f.label)} | ${f.status} | ${escapePipe(f.description)} |`,
  );
  return ["| Feature | Status | Description |", "| --- | --- | --- |", ...rows].join("\n");
}

function renderGlossaryMarkdown(): string {
  const sections = [
    "## CLI Flags",
    "",
    renderCliFlagsMarkdown(),
    "",
    "## Palette Commands",
    "",
    renderCommandsMarkdown(),
    "",
    "## Features",
    "",
    renderFeatureStatusMarkdown(),
  ];
  return sections.join("\n");
}

function renderQuickStartMarkdown(): string {
  return [
    "```bash",
    "# Linux / macOS native binary",
    NATIVE_INSTALL_SH,
    "",
    "# Windows PowerShell native binary",
    NATIVE_INSTALL_PS1,
    "",
    "# Or via Bun / npm",
    BUN_GLOBAL_INSTALL,
    NPM_GLOBAL_INSTALL,
    "",
    "# Verify install & mpv, then run setup and first search",
    VERSION_CHECK,
    MPV_VERSION_CHECK,
    CANONICAL_SETUP,
    FIRST_SEARCH,
    "```",
  ].join("\n");
}

/** Expand generated MDX tags into self-contained GFM tables for LLM/GEO ingestion. */
export function expandGeneratedMdxForLlms(markdown: string): string {
  return markdown
    .replace(/<CliFlagsTable\b[^>]*\/>/g, () => renderCliFlagsMarkdown())
    .replace(/<ProviderTable\b[^>]*\/>/g, () => renderProvidersMarkdown())
    .replace(/<CommandReference\b[^>]*\/>/g, () => renderCommandsMarkdown())
    .replace(/<ShortcutTable\b[^>]*\/>/g, () => renderShortcutsMarkdown())
    .replace(/<FeatureStatusTable\b[^>]*\/>/g, () => renderFeatureStatusMarkdown())
    .replace(/<GlossaryFromCodegen\b[^>]*\/>/g, () => renderGlossaryMarkdown())
    .replace(/<QuickStartSteps\b[^>]*\/>/g, () => renderQuickStartMarkdown());
}

/** Site-relative Markdown URL for a docs page (rewritten to `/llms.mdx/...`). */
export function docsMarkdownPath(pageUrl: string): string {
  const trimmed = pageUrl.replace(/\/+$/, "");
  return trimmed === "/docs" ? "/docs.mdx" : `${trimmed}.mdx`;
}

type ParsedRawFrontmatter = {
  readonly title?: string;
  readonly description?: string;
  readonly body: string;
};

function parseRawFrontmatter(raw: string): ParsedRawFrontmatter {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n*/);
  if (!match?.[1]) return { body: raw };
  const block = match[1];
  const unquote = (value: string | undefined) => value?.trim().replace(/^["']|["']$/g, "");
  return {
    title: unquote(block.match(/^title:\s*(.+)$/m)?.[1]),
    description: unquote(block.match(/^description:\s*(.+)$/m)?.[1]),
    body: raw.slice(match[0].length),
  };
}

/** Render one docs page as clean, self-contained Markdown for LLM consumption. */
export async function formatDocPageMarkdown(page: DocsPageItem): Promise<string> {
  let title = page.data.title;
  let description = page.data.description;
  let body: string;
  try {
    body = await page.data.getText("processed");
  } catch (error) {
    // Bun unit tests bypass the Next.js fumadocs-mdx loader, so `_markdown` is not compiled there.
    if (!(error instanceof Error && error.message.includes("includeProcessedMarkdown"))) {
      throw error;
    }
    const parsed = parseRawFrontmatter(await page.data.getText("raw"));
    title = title ?? parsed.title ?? page.url;
    description = description ?? parsed.description;
    body = parsed.body;
  }

  const lines = [
    `# ${title}`,
    "",
    `URL: ${docsCanonicalUrl(page.url)}`,
    `Markdown: ${docsSiteUrl}${docsMarkdownPath(page.url)}`,
    `Source: ${docsEditUrl(page.path)}`,
  ];
  if (description) {
    lines.push("", `> ${description}`);
  }
  lines.push("", expandGeneratedMdxForLlms(body).trim(), "");
  return lines.join("\n");
}
