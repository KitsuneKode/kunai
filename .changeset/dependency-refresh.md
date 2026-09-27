---
"@kitsunekode/kunai": patch
---

Refresh runtime and tooling dependencies within compatible ranges.

React and react-dom move to 19.3.0 alongside the matching type packages, and
zod, Bun types, Node types, turbo, and lint-staged take their in-range bumps.
The docs stack updates to Next 16.3.6 and Fumadocs 16.15.14 / fumadocs-mdx
15.4.5, with motion unified on 13.4.4 — the version fumadocs-ui already
requires — so the docs site no longer installs two major versions side by side.

One transitive pin carries a caveat: `mdast-util-to-markdown` is overridden to
2.1.2 because 2.1.3 regresses Fumadocs' MDX stringifier into infinite
recursion (RangeError: call stack) on `strong` nodes across the docs set. The
pin can drop once upstream fixes the regression.
