# shadcn stylesheet

`shadcn-tailwind.css` is the stylesheet from the MIT-licensed published
`shadcn@4.22.1` package, retained with its copyright notice in
`shadcn-LICENSE.md`. Source: https://registry.npmjs.org/shadcn/-/shadcn-4.22.1.tgz

Original file SHA-256: `4c371f7a1ff5d219ae2f7ff28bd256b4346fd546fe46fbae22092e57db2f0fae`.
Local formatter changes may change source bytes; compare the compiled Tailwind
output when updating it. The docs use its Base UI data-state/orientation variants.

The generator CLI is not a runtime/build dependency. Keeping this CSS local
avoids installing its registry, HTTP and AST tooling just to resolve an import.
Review a future upstream stylesheet as a source update, preserving the license
and verifying compiled CSS and the docs build. Component generation remains an
explicit maintainer operation; preserve `apps/docs/components.json`.
