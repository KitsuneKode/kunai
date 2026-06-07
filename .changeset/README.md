# Changesets

We use [changesets](https://github.com/changesets/changesets) to manage releases for `@kitsunekode/kunai`.

## Adding a changeset

```sh
bun run changeset
```

Select `@kitsunekode/kunai` and choose patch / minor / major.

## Body format

Write user-facing notes in the changeset body:

```markdown
One-line summary.

### Highlights

- ...

### Features

- ...

### Fixes

- ...

### Performance

- ...
```

See [RELEASING.md](../RELEASING.md) for the full release workflow.
