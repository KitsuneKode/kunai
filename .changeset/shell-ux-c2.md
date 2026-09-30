---
"@kitsunekode/kunai": patch
---

Single-key actions no longer fire while typing in a filter field, and
destructive keys now ask for a second press.

**Filter surfaces own their keys explicitly.** History, the episode picker,
and the offline library share the browse focus-zone model: printable letters —
including `x`, `q`, `m`, `s`, `w` — type into the filter while the text zone
owns input, the first arrow press hands focus to the list, and only the list
zone runs bare-letter actions. Esc unwinds one layer at a time: an armed
confirmation first, then list focus back to the filter, then the overlay. The
queue and notifications inbox have no filter field, so letters there stay
actions — and can no longer park keystrokes in an invisible editor whose first
Esc cleared a filter the user could not see.

**Destructive actions confirm with a matching second press.** Removing a queue
item (`x`), clearing the queue (`c`) or its played rows (`C`), deleting a
notification (`d`) or archived notices (`⇧C`), and deleting a finished or
failed download or a whole library title (`x`) all arm first: the footer
names the target and asks for the same key again within a few seconds, while
any other key cancels. The arm is scoped to the specific row, so moving the
selection can never confirm a different item, and the prompt expires on its
own.

**Footers and subtitles name the live mode.** Filter-focused surfaces show the
zone switch (`↑↓ list actions`) instead of advertising letters that would type;
list-focused surfaces show the real action keys. The episode-picker subtitle,
the library filter hint, and the delete/repair hints all switch copy with the
active zone.
