import type { LLMsOptions } from "fumadocs-core/mdx-plugins";

import { codeMetadata } from "./code-metadata";
import { docsRootCards, getDocHubGroup } from "./doc-hub";
import statusSeed from "./generated-provider-status.json";
import { NATIVE_INSTALL_PS1, NATIVE_INSTALL_SH } from "./install-commands";
import { provenance } from "./provenance";
import { docsSiteUrl } from "./site";

/**
 * How the generated JSX components inside docs/*.mdx serialize into the
 * Markdown served at /llms-full.txt and /llms.mdx/<page>. Without this the
 * corpus would either leak raw `<ProviderTable />` syntax or silently drop the
 * tables and card indexes that carry real information. Anything not handled
 * here falls back to `children-only`, which keeps the prose and drops the tag.
 *
 * mdast/mdast-util-mdx are not direct dependencies of this app, so the MDX node
 * shapes are described structurally rather than imported.
 */

type StringifyNode = Parameters<NonNullable<LLMsOptions["filterElement"]>>[0];
type StringifyState = Parameters<NonNullable<LLMsOptions["stringify"]>>[2];
type StringifyInfo = Parameters<NonNullable<LLMsOptions["stringify"]>>[3];

type JsxAttribute = { type: string; name?: string; value?: unknown };
type JsxFlowNode = {
  type: string;
  name: string;
  attributes: JsxAttribute[];
  children?: StringifyNode[];
};

const SCOPE_TITLES: Record<string, string> = {
  beta: "Beta: what to know first",
  privacy: "Privacy by default",
  providers: "Third-party providers",
  downloads: "Two download entry points",
};

const PROVIDER_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  candidate: "Candidate",
  production: "Production",
};

const SWEEP_STATUS_LABELS: Record<string, string> = {
  healthy: "Working",
  degraded: "Degraded",
  blocked: "Blocked",
  dead: "Down",
  unchecked: "Not checked",
};

function attrValue(node: JsxFlowNode, name: string): string | undefined {
  const attr = node.attributes.find(
    (a) => a.type === "mdxJsxAttribute" && a.name === name && typeof a.value === "string",
  );
  return attr?.value as string | undefined;
}

function childrenOf(node: JsxFlowNode, state: StringifyState, info: StringifyInfo): string {
  return state.containerFlow(node as never, info);
}

function table(headers: string[], rows: string[][]): string {
  const esc = (cell: string) => cell.replace(/\|/g, "\\|").replace(/\n/g, " ");
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(esc).join(" | ")} |`),
  ].join("\n");
}

function providerTableMarkdown(): string {
  const rows = codeMetadata.providers.map((provider) => {
    const status = PROVIDER_STATUS_LABELS[provider.status] ?? provider.status;
    return [
      provider.displayName,
      provider.domain,
      provider.mediaKinds.join(", "),
      status,
      provider.description,
    ];
  });
  return [
    table(["Provider", "Domain", "Media", "Status", "Description"], rows),
    "",
    `Full detail: ${docsSiteUrl}/docs/users/providers`,
  ].join("\n");
}

function docSectionCardsMarkdown(node: JsxFlowNode): string | undefined {
  const group = attrValue(node, "group");
  const section = group ? getDocHubGroup(group as never) : undefined;
  if (!section) return undefined;
  const items = section.items.map(
    (item) => `- [${item.title}](${docsSiteUrl}${item.href}): ${item.description}`,
  );
  return [`### ${section.title}`, "", section.description, "", ...items].join("\n");
}

function docsRootCardsMarkdown(): string {
  return docsRootCards
    .map((item) => `- [${item.title}](${docsSiteUrl}${item.href}): ${item.description}`)
    .join("\n");
}

function cliFlagsTableMarkdown(): string {
  return table(
    ["Flag", "Description"],
    codeMetadata.cliOptions.map((flag) => [
      flag.short ? `${flag.short}, ${flag.long}` : flag.long,
      flag.description,
    ]),
  );
}

function shortcutTableMarkdown(): string {
  return table(
    ["Context", "Keys", "Action"],
    codeMetadata.shortcuts.map((row) => [row.group, row.keys, row.label]),
  );
}

function featureStatusTableMarkdown(): string {
  return table(
    ["Capability", "Status", "Notes"],
    codeMetadata.featureStatus.map((feature) => [
      feature.label,
      feature.status,
      feature.description,
    ]),
  );
}

function commandReferenceMarkdown(node: JsxFlowNode): string {
  const limit = Number(attrValue(node, "limit"));
  const commands = Number.isFinite(limit)
    ? codeMetadata.commands.slice(0, limit)
    : codeMetadata.commands;
  return [
    table(
      ["Command", "Label", "Aliases", "Description"],
      commands.map((cmd) => [
        `/${cmd.id}`,
        cmd.label,
        cmd.aliases.length > 0 ? cmd.aliases.join(", ") : "-",
        cmd.description || "-",
      ]),
    ),
    "",
    `${codeMetadata.commandCount} shell commands registered in the CLI.`,
  ].join("\n");
}

function glossaryMarkdown(): string {
  const commandTerms = codeMetadata.commands.map((command) => ({
    term: `/${command.id}`,
    definition: command.description || command.label,
  }));
  const flagTerms = codeMetadata.cliOptions.map((option) => ({
    term: option.long,
    definition: option.description,
  }));
  const featureTerms = codeMetadata.featureStatus.map((feature) => ({
    term: feature.label,
    definition: `${feature.status}: ${feature.description}`,
  }));
  return [...commandTerms, ...flagTerms, ...featureTerms]
    .sort((a, b) => a.term.localeCompare(b.term))
    .map((entry) => `- **${entry.term}** — ${entry.definition}`)
    .join("\n");
}

function syncedAtMarkdown(): string {
  const synced = new Date(provenance.syncedAt).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
  const revision =
    provenance.cliSourceRevision && provenance.cliSourceRevision !== "unknown"
      ? ` · source ${provenance.cliSourceRevision}`
      : "";
  return `_Generated from the Kunai CLI (v${codeMetadata.version}) at ${synced} UTC${revision}._`;
}

function statusBoardMarkdown(): string {
  // The bundled seed JSON directly — `lib/provider-status.ts` drags in
  // `@kunai/types`, whose extensionless imports fail when fumadocs-mdx loads
  // this file through native Node ESM while building source.config.
  const rows = statusSeed.providers.map((provider) => [
    provider.id,
    SWEEP_STATUS_LABELS[provider.effectiveStatus] ?? provider.effectiveStatus,
    provider.note || "-",
  ]);
  return [
    table(["Provider", "Status", "Note"], rows),
    "",
    `_Daily sweep result from ${statusSeed.generatedAt}. Live board: ${docsSiteUrl}/status_`,
  ].join("\n");
}

function quickStartMarkdown(): string {
  return [
    "### Install",
    "",
    "```bash",
    NATIVE_INSTALL_SH,
    "```",
    "",
    "```powershell",
    NATIVE_INSTALL_PS1,
    "```",
    "",
    "Then run `kunai`, pick a title, and playback opens in mpv.",
  ].join("\n");
}

function docsHubIntroMarkdown(node: JsxFlowNode): string {
  const lead = attrValue(node, "lead") ?? "";
  const sublead = attrValue(node, "sublead");
  return [`**${lead}**`, "", sublead ?? ""].join("\n").trim();
}

function asJsxFlow(node: StringifyNode): JsxFlowNode | undefined {
  const element = node as Partial<JsxFlowNode>;
  return node.type === "mdxJsxFlowElement" && typeof element.name === "string"
    ? (element as JsxFlowNode)
    : undefined;
}

export const llmsMarkdownOptions: LLMsOptions = {
  filterElement(node) {
    switch (node.type) {
      case "mdxjsEsm":
        return false;
      case "mdxJsxFlowElement":
      case "mdxJsxTextElement":
        // Handled components return a string from `stringify` below; for
        // everything else (Callout, Steps, Cards, banner wrappers, …) the
        // prose inside is what a reader wants, not the tag around it.
        return "children-only";
      default:
        return true;
    }
  },
  stringify(node, _parent, state, info) {
    const element = asJsxFlow(node);
    if (!element) return undefined;
    switch (element.name) {
      case "ProviderTable":
        return providerTableMarkdown();
      case "DocSectionCards":
        return docSectionCardsMarkdown(element);
      case "DocsRootCards":
        return docsRootCardsMarkdown();
      case "CliFlagsTable":
        return cliFlagsTableMarkdown();
      case "ShortcutTable":
        return shortcutTableMarkdown();
      case "FeatureStatusTable":
        return featureStatusTableMarkdown();
      case "CommandReference":
        return commandReferenceMarkdown(element);
      case "GlossaryFromCodegen":
        return glossaryMarkdown();
      case "SyncedAt":
        return syncedAtMarkdown();
      case "ProviderStatusBoard":
        return statusBoardMarkdown();
      case "QuickStartSteps":
        return quickStartMarkdown();
      case "DocsHubIntro":
        return docsHubIntroMarkdown(element);
      case "ProviderDocSection": {
        const title = attrValue(element, "title");
        const body = childrenOf(element, state, info);
        return `## ${title ?? "Provider"}\n\n${body}`;
      }
      case "ScopeCallout": {
        const variant = attrValue(element, "variant") ?? "beta";
        const title = attrValue(element, "title") ?? SCOPE_TITLES[variant] ?? "Note";
        const children = element.children?.length
          ? `\n>\n> ${childrenOf(element, state, info).replace(/\n/g, "\n> ")}`
          : "";
        return `> **${title}**${children}`;
      }
      case "Tab": {
        const label = attrValue(element, "value") ?? attrValue(element, "label");
        const body = childrenOf(element, state, info);
        return label ? `**${label}**\n\n${body}` : body;
      }
      default:
        return undefined;
    }
  },
};
