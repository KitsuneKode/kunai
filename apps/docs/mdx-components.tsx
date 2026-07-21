import { DocSectionCards } from "@/components/docs/doc-section-cards";
import { DocsHubIntro } from "@/components/docs/docs-hub-intro";
import { DocsRootCards } from "@/components/docs/docs-root-cards";
import { ProviderDocSection } from "@/components/docs/provider-doc-section";
import { QuickStartSteps } from "@/components/docs/quick-start-steps";
import { ScopeCallout } from "@/components/docs/scope-callout";
import { CliFlagsTable } from "@/components/reference/cli-flags-table";
import { CommandReference } from "@/components/reference/command-reference";
import { FeatureStatusTable } from "@/components/reference/feature-status-table";
import { GlossaryFromCodegen } from "@/components/reference/glossary-from-codegen";
import { ProviderTable } from "@/components/reference/provider-table";
import { ShortcutTable } from "@/components/reference/shortcut-table";
import { SyncedAt } from "@/components/reference/synced-at";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";

const fumadocsUiComponents = {
  Step,
  Steps,
  Tab,
  Tabs,
} satisfies MDXComponents;

const kunaiMdxComponents = {
  ProviderTable,
  CommandReference,
  CliFlagsTable,
  FeatureStatusTable,
  GlossaryFromCodegen,
  ShortcutTable,
  SyncedAt,
  DocSectionCards,
  DocsRootCards,
  DocsHubIntro,
  QuickStartSteps,
  ScopeCallout,
  ProviderDocSection,
} satisfies MDXComponents;

export function useMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    ...fumadocsUiComponents,
    ...kunaiMdxComponents,
    ...components,
  };
}
