import { baseOptions, docsSidebar } from "@/lib/layout.shared";
import { source } from "@/lib/source";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";

export default function Layout({ children }: { readonly children: ReactNode }) {
  return (
    <DocsLayout {...baseOptions()} tree={source.getPageTree()} sidebar={docsSidebar}>
      {children}
    </DocsLayout>
  );
}
