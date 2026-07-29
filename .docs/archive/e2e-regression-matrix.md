# End-to-end regression matrix

Date: 2026-06-25. Release gate (Phase E0).

| Scenario                      | Automated assertion                              | Manual smoke                                |
| ----------------------------- | ------------------------------------------------ | ------------------------------------------- |
| First-watch multi-season      | `smart-auto-launch.test.ts` → menu shown         | Launch series without history; menu appears |
| History/Continue resume       | `resolvePlaybackEpisodeEntry` clean resume       | Continue from history; instant play         |
| Queue auto-advance            | `playback-advance.test.ts` queue kind            | Queue 2 titles; eof advances                |
| Share-link launch             | `share-bootstrap` unit tests                     | `kunai open` share URL                      |
| Offline launch                | offline playback launch tests                    | Play downloaded episode                     |
| Calendar continue             | calendar-continue-launch tests                   | Calendar entry plays                        |
| Provider switch mid-session   | `run-post-playback-menu.test.ts` handled→restart | Switch provider in post-play                |
| Dead-stream recovery          | `run-post-playback-menu.test.ts` recovery panel  | Kill stream mid-play                        |
| Caught-up / finale / complete | `post-play-state.test.ts` kinds                  | Finish last aired ep                        |
| Title Control `m` / `/menu`   | `title-control.test.ts` + keybindings            | Open menu from browse/loading/post-play     |
| Footer ↔ binding lockstep     | `buildFooterActionsFromBindings` tests           | Footer keys match live input                |
| No input hijack               | `input-router` ownership tests                   | `m` inert in search; Esc always works       |

Run before release: `bun run typecheck && bun run lint && bun run fmt && bun run test && bun run build && bun run pkg:check`
