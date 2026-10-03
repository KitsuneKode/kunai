import { NavExpander } from "@/components/layout/nav-expander";
import { NavSearchTrigger } from "@/components/layout/nav-search-trigger";
import { baseOptions } from "@/lib/layout.shared";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import type { ReactNode } from "react";

/**
 * The floating-nav layout every non-docs page shares.
 *
 * It adds the two pieces only the floating pill needs: the search button whose
 * label and key hint can collapse, and the expander. They are not in
 * `baseOptions()` because the docs layout spreads that too, and there a node
 * standing in for the search trigger would replace the sidebar's full-width one.
 */
export function KunaiHomeLayout({ children }: { readonly children: ReactNode }) {
  const base = baseOptions();
  return (
    <HomeLayout
      {...base}
      nav={{ ...base.nav, children: <NavExpander /> }}
      searchToggle={{ ...base.searchToggle, components: { lg: <NavSearchTrigger /> } }}
    >
      {children}
    </HomeLayout>
  );
}
