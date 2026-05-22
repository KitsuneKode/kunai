# Episode And Season Picker

Approved direction:

```text
Dense episode list + selected preview rail
```

This picker is shared by:

- post-playback episode selection
- active playback episode switching
- season navigation
- next-season transitions

## Layout

Left:

- season tabs or season selector
- dense episode list
- watched/current/available/upcoming states

Right:

- selected episode thumbnail
- season poster fallback
- episode title and metadata
- progress/watched state
- tracks/provider availability if useful
- next/previous context

The preview rail must reserve the thumbnail/poster slot before media loads. Metadata below the image should stay anchored and must not jump when rendering finishes.

## Episode Row Data

Rows may show:

- episode code
- episode title
- runtime
- air date
- watched/current/available/upcoming state

Do not show unavailable future episodes as normal playable rows.

## States

- watched
- current
- available
- upcoming/not aired
- missing metadata
- unavailable from provider

## Footer

```text
[↑↓] select   [enter] play   [s] season   [/] commands   [esc] back
```

## Responsive

Preview rail hides first.

On narrow terminals, keep:

- current season
- episode code/title
- state
- footer basics
