---
"@kitsunekode/kunai": patch
---

Add explicit mouse selection and activation to Library and Up Next. Library tabs
work in both directions, covered queue controls release pointer ownership, and
large queues render only the visible window. Mouse and Enter share exact-row
queue claims and report unavailable items instead of silently dropping the action.
