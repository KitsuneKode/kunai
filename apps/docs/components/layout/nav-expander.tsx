import { IconDots } from "@tabler/icons-react";

/**
 * The "there is more here" control of the compact nav.
 *
 * Hidden at the top of the page and on phones, where the full nav or the menu
 * button is already showing. Once the nav has shrunk it is the one thing that says
 * the bar is not finished: hover or keyboard focus expands it in CSS, and pressing
 * this pins it open, which is the only way in on a touch screen. The press is
 * handled by `NavCompact` (one listener for the document), which also keeps
 * `aria-expanded` current, so this stays a plain server component.
 */
export function NavExpander() {
  return (
    <span className="kunai-nav-expander">
      <button
        type="button"
        data-nav-expander=""
        aria-expanded="false"
        aria-label="Show all navigation links"
        title="Show navigation"
        className="text-fd-muted-foreground hover:text-fd-foreground inline-flex h-8 items-center justify-center rounded-full transition-colors"
      >
        <IconDots className="size-4" stroke={1.5} aria-hidden="true" />
      </button>
    </span>
  );
}
