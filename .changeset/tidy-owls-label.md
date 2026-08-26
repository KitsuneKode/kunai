---
"@kitsunekode/kunai": patch
---

Stop a malformed language tag from crashing playback, and clear the encoded ref out of the Discord state row.

### Fixes

- **A language label could take down a resolve.** The playback source inventory
  formatted language names with `Intl.DisplayNames.of()` and no guard, and that
  call throws `RangeError: argument is not a language id` for anything that is
  not a well-formed BCP-47 tag. Several values reaching it are not: YouTube's
  `a.en` auto-caption codes, `live_chat`, and `none` — which Kunai ships itself
  as the default series subtitle preference. The result was an unhandled
  rejection as a stream was being resolved. Labels are now derived from
  progressively less specific candidates, so a valid tag keeps its precise name
  (`en-US` stays "American English"), `a.en` resolves to "English", and anything
  unmappable degrades to the raw value instead of throwing. YouTube subtitle
  filtering now also recognizes dotted auto-caption tags and drops its
  `live_chat` metadata track before it can reach the picker.
- **The Discord state row no longer carries the encoded `kunai://` ref.** It was
  appended there from when the ref could not be a button. Discord truncates that
  row, so a long ref cut off mid-query and crowded out the progress beside it.
  The ref now has its own button and remains in `playable_ref`, so the visible
  text stays readable.
