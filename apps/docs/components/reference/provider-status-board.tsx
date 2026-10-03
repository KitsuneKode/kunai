import { ProviderStatusPanel } from "@/components/status/provider-status-panel";

/**
 * The board as the guide embeds it. It is the same panel the `/status` page shows,
 * so the guide and the page can never disagree about a provider; this name is what
 * the MDX page and `mdx-components.tsx` already refer to.
 */
export function ProviderStatusBoard() {
  return <ProviderStatusPanel />;
}
