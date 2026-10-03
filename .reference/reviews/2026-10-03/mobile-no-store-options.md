# Mobile without publishing a Kunai app

Researched: 2026-10-03. This is a proposed direction, not implemented support
or physical-device qualification. Research used current first-party platform
documentation and the checked-out mobile entrypoint/application. No runtime,
dependency, account, network exposure, or production settings were changed.

## Recommendation

The user's selected default is **phone playback while the computer is off**.
Start with a **touch Home Screen web UI → explicitly qualified direct playback
in VLC** experiment. Deliver catalog/episode selection, saved collections, and
manual Up Next first; qualify one source path on both phones before expanding.
This is an inferred product recommendation, not proof that the current CLI
providers run in browsers. Retain the terminal host proof for qualification,
but do not require ordinary users to type commands for each viewing session.

Choose the resolver ownership explicitly. A browser-compatible provider subset
can run entirely on-phone. A user-owned always-on HTTPS backend can retain
server-side provider logic and return bounded metadata/probed stream
descriptors without moving media bytes through Kunai. The latter works with the
personal computer off, but is not entirely on-phone execution: somebody owns
and operates a server. Do not introduce a hardcoded shared resolver or pretend
the existing mobile proof includes this backend.

For a faster low-cost host-based experiment with the already-installed apps,
test iPhone Shortcuts menus + bounded a-Shell actions and Android Termux:Widget
with a local touch page. Those retain on-phone execution without publishing a new
app, but have different UIs and lifecycle limits. They should prove the runtime
and source contract before a large frontend investment.

An optional later **desktop touch companion** preserves existing server-side
SQLite/download/player behavior. It cannot satisfy the primary computer-off
requirement. In that optional product, make the playback destination explicit:

- **Play on computer:** phone controls desktop mpv. Existing player events can
  drive progress, Up Next, and post-play decisions through the application.
- **Play on this phone:** a separate, later-qualified direct-stream handoff to
  VLC. Opening VLC does not establish watched progress or reliable automatic
  queue advancement. Keep manual completion/next actions until actual player
  events are available.

A standalone Home Screen web app is not a drop-in way to run all existing
providers, yt-dlp jobs, or desktop SQLite on iOS/Android. Test one real provider
journey on both phones with no desktop, without adding a shared media proxy to
disguise the limits.

## Three routes compared

| Route | Phone setup | What can be reused | Main constraint | Decision |
| --- | --- | --- | --- | --- |
| Standalone PWA with direct playback or VLC handoff | Open HTTPS site; add to Home Screen; optional VLC | Portable TypeScript policy, identity models, UI designs; new browser adapters | Browser fetch/header/codec/storage/background constraints; no automatic provider parity | Primary UX direction; first prove one bounded source path |
| PWA + user-owned hosted descriptor service | Same phone setup, plus configure personal HTTPS endpoint | Server-side provider work behind new bounded API | Always-on server operation and security; server probe does not prove phone request | More provider reuse if backend dependency is accepted; no media proxy |
| iPhone Shortcuts/a-Shell + Android Widget/local web | Existing hosts + imported shortcut/launcher + VLC | Small portable core, platform HTTP/state ports | Distinct platform UX and lifecycle; still new catalog/structured actions | Fastest on-phone host-based proof candidate, unqualified |
| User-owned desktop companion with touch web UI | Scan QR; browser; optional Home Screen icon; VLC only for phone playback | Existing server-side resolver, storage, downloads, player/application services | Computer must be reachable and running; secure pairing and HTTPS still require implementation | Optional later; fails primary computer-off requirement |
| Kunai Stremio addon | Existing Stremio app/Web + addon URL; iPhone Web can hand off to VLC | Provider/catalog adapters behind a dedicated addon service | Host owns UX/state; addon API does not expose Kunai's queue/download mutation contract; iOS native distribution varies | Credible integration experiment, not the full feature-preserving product |

Kodi is a possible TV/computer integration later, but is a poor shortcut to
easy iPhone installation: its official iOS instructions include sideloading
and signing, while the download page highlights jailbroken installations.
Do not make Kodi a prerequisite for the phone launch. [Kodi iOS downloads](https://kodi.tv/download/ios/),
[Kodi installation guide](https://kodi.wiki/view/HOW-TO%3AInstall_Kodi_for_iOS).

## Home Screen installation is possible; runtime parity is separate

Apple's current instructions are Safari → Share → Add to Home Screen → enable
Open as Web App → Add. WebKit says Safari 26 can open any added website as a web
app, even without earlier installability requirements. A manifest, icons, and
an offline shell still improve the product; a Home Screen icon alone does not
create offline media, native process access, or background downloads.
[Apple installation steps](https://support.apple.com/en-eg/guide/iphone/iphea86e5236/ios),
[WebKit Safari 26 web apps](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/).

Serve the UI and API from the same HTTPS origin when practical. Service workers
require a secure context. The localhost exception refers to the device's own
loopback host; a computer's ordinary HTTP LAN address is not that exception on
the phone. Do not market an HTTP LAN page as a fully installed, secure offline
PWA. [Secure contexts documentation](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts).

A public HTTPS frontend calling an HTTP LAN backend creates additional browser
policy work. Chrome's Local Network Access mechanism requires permission and
defines limited mixed-content exemptions; its guidance also notes that those
exemptions are not universal across browsers. A recent WebKit implementation
change is marked Nightly Build, not proof of shipping iPhone behavior. Qualify
actual Safari/Chrome versions rather than use browser flags as an installation
requirement. [Chrome Local Network Access](https://developer.chrome.com/blog/local-network-access),
[WebKit implementation status](https://bugs.webkit.org/show_bug.cgi?id=324190).

An optional power-user solution is **Tailscale Serve** in front of a loopback
companion. Serve exposes a local service within the user's tailnet over HTTPS;
Funnel exposes it publicly and is a different choice. Tailnet access rules still
apply. This offers a concrete private-access route instead of asking users to
trust a self-signed certificate or open their router. It introduces an account
and another existing app, so it is not zero-install onboarding.
[Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve).

Tailscale has Android and iPhone clients. Its HTTPS setup requires consent and
publishes certificate hostnames to Certificate Transparency; avoid sensitive
device names. This note does not enable that setting or install/configure a VPN.
[Android setup](https://tailscale.com/docs/install/android),
[iPhone setup](https://tailscale.com/docs/install/ios),
[HTTPS setup and hostname disclosure](https://tailscale.com/docs/how-to/set-up-https-certificates).

## Host-based touch controls without a Kunai store app

Apple Shortcuts provides menus and selectable lists, so title/episode choices
need not be terminal prompts. a-Shell exposes Execute Command, Put File, and
Get File actions. Its README distinguishes lightweight extension execution
from opening the app for fuller commands; forcing an execution mode is not a
guarantee that a command works. [Apple menu/list actions](https://support.apple.com/guide/shortcuts/use-the-choose-from-menu-action-apdd7bf369da/ios),
[a-Shell Shortcuts contract](https://github.com/holzschu/a-shell#shortcuts).

There is a concrete compatibility seam to test: the jsc manual documents
JavaScriptCore in Shortcuts extensions, while the current command handler's
automatic lightweight allowlist contains curl and omits jsc. Extension results
carry captured output and an exit status; app mode requests continuation into
a-Shell. Its lightweight comment describes work shorter than five seconds,
not a dependable background resolver/download budget. Treat source comments
as intent, not a measured OS limit. Verify the installed mini version's
command availability, result transport, forced-extension behavior, and failure
cleanup. [jsc manual](https://github.com/holzschu/a-shell/blob/master/man/man1/jsc.1),
[Execute Command implementation](https://github.com/holzschu/a-shell/blob/master/a-Shell-Intents/ExecuteCommandIntentHandler.swift).

Prototype: Shortcut asks for a title, receives a bounded structured result,
shows a list, chooses episode/source, invokes a qualified handoff, and offers
manual completion/next after return. Pass untrusted values as data in fixed
private files, not by constructing command strings or evaluating JavaScript.
The existing proof needs a new non-interactive structured action contract; it
currently prompts and has no catalog. Do not merely pipe fake keystrokes into
it and call that a mobile product. Do not rely on a-Shell staying alive as a
localhost daemon after VLC or Safari takes foreground ownership.

On Android, Termux:Widget can launch scripts from Home Screen and offers a
background-task directory. A launcher could start a **phone-local**, loopback
Node server and open its touch UI in the browser, retaining on-device request
and file APIs. This is an architecture proposal, not code already present.
Loopback HTTP receives the secure-context exception, but still requires
authorization/Origin/Host validation: local does not mean arbitrary websites
may control it. [Termux:Widget](https://github.com/termux/termux-widget),
[Secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts).

Termux and plugins must have matching signing sources. Its official app README
also warns that Android can kill Termux processes; a widget task is not a
guarantee of durable background downloads. Qualify process death, restart,
locked-screen behavior, visible running status, and explicit stop/uninstall
before supporting this path. Do not disable system protections as the ordinary
installation requirement. [Termux installation and process limits](https://github.com/termux/termux-app).

These two host adapters can reduce typing immediately, but do not give both
platforms an identical polished interface or background runtime. Prefer one
small proof on each existing host, then pick a common web UI only if source
compatibility and lifecycle evidence justify it.

## What browsers and external players change

Browser API/scrape fetches must meet CORS rules. A header accepted by Bun is not
automatically usable by a browser, and third-party cookie policy remains a
separate constraint. A plain cross-origin media element is not equivalent to a
JavaScript HLS loader or provider scrape; do not claim that CORS blocks every
ordinary MP4 playback. Qualify the actual fetch/decoder path and supplied
request profile. [CORS documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS),
[Web media formats](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats).

Android Chrome can launch a browsable external activity with an intent link
following a user gesture, with a fallback if no handler exists. A timer-driven
launch without that gesture is not reliable. Resolve/probe first, then present
an explicit Open VLC button; handle missing VLC and returning to the page.
[Chrome Android intents](https://developer.chrome.com/docs/android/intents),
[VLC Android manifest](https://github.com/videolan/vlc-android/blob/master/application/vlc-android/AndroidManifest.xml).

VLC's published iOS integration describes an x-callback stream URL with an
encoded media URL and a return callback. A return action is not a continuous
position/EOF API. Physical tests must qualify current VLC behavior rather than
infer completed viewing from handoff acceptance or an app return.
[VideoLAN integration description](https://mailman.videolan.org/pipermail/vlc-devel/2014-October/099830.html).

**A computer's successful stream probe does not establish phone compatibility.**
The phone may use another IP, network, player, header set, or cookie context.
For a first phone-playback release, select credential-free direct candidates
whose request profile survives that handoff, and record actual phone playback
per provider/format/network. If the phone cannot perform the required probe or
request, state unsupported instead of bypassing `verifyCandidateStream` or
silently forwarding video through Kunai.

## Downloads and real offline playback

Keep three states visible: **downloaded on computer**, **saved on phone**, and
**metadata available offline**. They are different products. A disconnected
companion cannot play a file that remains only on the computer, even if its UI
shell and poster are cached on the phone.

For the fastest actual phone-offline path, let the existing desktop downloader
finish and validate a file, then guide the user through transferring that file
to VLC. VLC iOS documents computer-to-phone WiFi Upload, direct file downloads,
and opening local files. Its WiFi upload page requires the VLC app to remain
open; arbitrary website video extraction is not offered by its direct-download
feature. This is a manual existing-app route to qualify, not a claim that Kunai
already automates transfers. [VLC media synchronization](https://docs.videolan.me/vlc-user/ios/3.X/en/gettingstarted/media_synchronization.html).

Browser Background Fetch is still documented as limited availability. A service
worker alone does not guarantee completion of a long movie download when the
browser is suspended. Treat phone background downloads as a separate feature
gate, with interrupt/resume/storage tests per platform, rather than a required
first release promise. [Background Fetch documentation](https://developer.mozilla.org/en-US/docs/Web/API/Background_Fetch_API).

WebKit storage defaults to best effort and can be evicted under pressure.
Request persistence and inspect estimated quota, but handle denials, full
storage, and missing files. Installed Home Screen applications have different
ITP treatment from ordinary browsing; the blanket claim that every installed
iPhone PWA loses everything after seven days is inaccurate. Neither exception
makes browser media storage equivalent to a user-owned file in VLC/Files.
[WebKit storage policy](https://www.webkit.org/blog/14403/updates-to-storage-policy/),
[Home Screen ITP exception](https://webkit.org/tracking-prevention/).

Do not add a Kunai media relay under the existing metadata-only relay contract.
Manual file transfer needs no new relay. An eventual private artifact-serving
feature would need a separate explicit architecture/security decision rather
than being hidden inside the companion API.

## Existing-app integration: Stremio is real, with limits

Stremio's addon protocol exposes manifest, catalog, metadata, stream and subtitle
resources over HTTP. It requires addon responses to allow all origins. Implement
a separate narrowly scoped read-only addon adapter, with private capability
handling, rather than enabling wildcard CORS on the privileged companion
control API. Installing an addon does not supply Kunai's reorder, download
pause, deletion, repair, or post-play mutation semantics.
[Official addon protocol](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md).

Its stream schema supports direct URLs and marks streams with proxy headers as
not Web-ready. This is evidence of a compatibility boundary, not a reason to
introduce a Kunai shared proxy. Mapping current provider request profiles must
be reviewed individually. [Official stream response schema](https://raw.githubusercontent.com/Stremio/stremio-addon-sdk/master/docs/api/responses/stream.md).

The current official downloads page lists Android packages, limited iOS Web,
and a full iOS route through AltStore PAL for named regions. Its iPhone Web
guide supports an external-player setup with VLC/Outplayer and explains that
Stremio Service is needed for additional browser conversion/torrent features.
Do not promise universal easy native iPhone installation or inherit support
claims from another app's brand. The guide's historical Safari-only PWA wording
should not override newer WebKit platform documentation.
[Current Stremio distribution](https://www.stremio.com/downloads),
[Official iPhone Web/external-player guide](https://blog.stremio.com/using-stremio-web-on-iphone-ipad/).

If an always-on hosted backend is acceptable, a **one-provider Stremio addon**
is the smallest credible experiment that borrows an already-built visual
catalog/player frontend. The same user-owned service can be online while the
personal computer is off; stream metadata goes to the client and media stays
direct. If every resolver operation must happen on the phone, an ordinary
remote HTTP addon does not meet that requirement. Implement no hosted shared
default, and qualify source identity, probe/request parity, auth, URL expiry,
limits, and actual iPhone/Android playback before expanding.

Treat that experiment as an integration capability, with host-owned library
and playback behavior. Do not display Kunai queue/download/watch-progress
promises through Stremio until its client exposes a verified contract for
those actions and events. The addon protocol is not that contract. Choosing
Stremio can save frontend work; choosing Kunai's own web UI preserves control
over Up Next, saved collections, offline state, and support UX. Neither choice
solves iPhone background downloads merely by installing a Home Screen icon.

## Smallest feature-preserving companion release

The following is the **optional desktop product**, not the selected phone-only
launch. For the primary launch, stage: existing physical host proof → one
phone-only structured catalog/episode/source journey → touch presentation →
manual Up Next and saved lists → explicit phone-owned offline qualification.
Decide first whether a user-owned hosted descriptor backend is acceptable.
Do not expand phone download/autoplay promises before those ownership gates.

This is proposed work, not an already-existing command or endpoint:

1. QR pairing, visible connected computer, disconnect/revoke action, and a clear
   unavailable/sleeping-computer state. Keep the service loopback by default;
   expose it only through an explicitly selected secure user-owned transport.
2. Search → title → episode → qualified source → Play on computer. Include one
   anime and one TMDB journey before calling both lanes supported.
3. Now Playing with current title/episode, pause/resume/seek and destination.
   Show Up Next as a separate ordered list: next/end/reorder/remove/clear,
   pending versus in-flight status, and explicit crash restore without autoplay.
4. Post-play screen from actual desktop events: replay, next item, source retry,
   add recommendation to Up Next, or return to browse. Keep playlists as saved
   collections and Up Next as current playback intent.
5. Downloads read model plus confirmed enqueue/pause/retry/cancel. Never derive
   completion from a progress bar; show validated artifact availability and
   destination. Add offline library management only through owned service APIs.
6. Separately qualify Play on this phone, manual completion, and manual file
   transfer. No hidden background download, optimistic watched marking, or
   automatic queue advance from a VLC launch/return.

Reuse portable TypeScript policy after dependency-graph review. Do not import
`apps/cli` into another app; extract only genuinely shared application/domain
contracts to a package behind narrow ports. Ink renders terminal elements;
browser React needs a new touch presentation. Bun/Node process APIs and the
current native SQLite access stay server-side. Existing `apps/mobile` is only
a bounded HTTP/state/handoff host proof, as confirmed by its entrypoint and
`run-mobile-application.ts`; it is not this proposed companion.

Suggested security acceptance: single-use expiring pairing exchange, per-device
revocation, authorization on every endpoint, validated Host/Origin, explicit
state-changing methods, CSRF protection, idempotent mutations, rate/body bounds,
no shell-string endpoints, no arbitrary fetch/path parameters, no analytics or
watch-history logging without consent. A network VPN is helpful transport, not
permission for every device to control playback or delete files.

Proposed release thresholds, not measurements: every supported phone/browser
passes pairing/revocation, both lane journeys, cancellation, reconnect, queue
reorder/recovery, and download failure/repair with no data loss or surprise
playback. For a small controlled tester cohort, target at least 95% first-play
success on declared fixtures and p95 control acknowledgement below one second
on the qualified network. Report provider resolve time separately. Real phone
offline qualification requires airplane-mode playback of the transferred file.
Test desktop-disconnected state, phone lock/background/return, missing VLC,
expired URLs, full disk/quota, concurrent clients, and interrupted updates.

Release the narrow route when those gates pass. Skipping an app-store submission
removes a distribution step; it does not remove the new UI/API/security work.
No responsible date estimate follows from the existing host proof alone.

## Questions that choose the route

1. **Already answered:** computer-off phone playback is the default. Remaining
   decision: may provider resolution use a user-owned hosted service, or must
   the complete resolver also execute on the phone?
2. Is the first successful journey **watch on the phone** or **use the phone as
   a remote for computer/TV playback**?
3. For offline v1, is **manual transfer to VLC** acceptable, or must Kunai own
   on-phone background downloads and resume?
4. Is an existing-app dependency such as **VLC + optional Tailscale** acceptable,
   or must onboarding be just a public HTTPS link?
5. For qualification now, are Android USB debugging/authorization available,
   and are the tester-owned credential-free HTTPS probe/media URLs ready?

The easiest compelling demo for the companion is scan → choose title → reorder
Up Next → play on the selected destination. For growth, show that real journey,
state the computer/player requirements before onboarding, and share stable
title identities rather than expiring private stream URLs. Measure successful
first playback and repeat use with explicit consent, not a promised viral
outcome. Keep maintenance focused on one frontend/contract rather than
simultaneously starting native, standalone PWA, Kodi, and Stremio products.
