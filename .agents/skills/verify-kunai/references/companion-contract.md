# Companion Verification and Security Contract

The local web companion (`kunai serve`) enables browser playback and remote controls on the same device. It binds strictly to loopback (`127.0.0.1`) and enforces strict security and resource contracts.

## 1. Host Header Validation and Port 80 Normalization

- **Contract**: The companion server accepts requests only when the `Host` header strictly matches the bound loopback host and port.
- **Port 80 Normalization**:
  - `Host: 127.0.0.1` and `Host: 127.0.0.1:80` must normalize identically through standard URL parsing.
  - A server binding port 80 must accept both `127.0.0.1` and `127.0.0.1:80`; the `localhost` alias remains refused at the HTTP boundary.
  - Non-matching hosts (e.g. `Host: 192.168.1.50:8080`, `Host: evil.com`) must immediately return HTTP 403 Forbidden.
- **Recipe**:
  - GET `http://127.0.0.1:<port>/api/status` with `Host: foreign.host` → 403 Forbidden.
  - GET `http://127.0.0.1:<port>/api/status` with matching `Host: 127.0.0.1:<port>` → proceeds to authentication gate.

## 2. Foreign Origin Rejection (CORS)

- **Contract**: Companion APIs are strictly same-origin. Cross-origin requests from foreign websites must be rejected before processing sensitive state.
- **Observable Proof**:
  - Request with `Origin: https://malicious-site.example` → HTTP 403 Forbidden.
  - No `Access-Control-Allow-Origin: *` or wildcard headers may ever be returned.
- **Media Route CORS**:
  - The local media proxy allows only the exact companion browser origin (`http://127.0.0.1:<port>`), scoped to the streaming session.

## 3. Cookie Isolation across Loopback Ports

- **Hazard**: In standard browsers (Chromium, Firefox, WebKit), cookies set on `127.0.0.1` or `localhost` can be sent across different ports on the same host unless isolated.
- **Contract**:
  - Companion APIs must require an explicit session credential (Bearer token), refuse ambient loopback cookies. The server sets no auth cookie; API calls send `Authorization: Bearer <run-secret>` with `credentials: "omit"`.
  - Initial handshake requires `POST /api/session` with the exact run secret generated on CLI launch.
  - Requests without the explicit credential must be refused with HTTP 403. Store it only in origin/tab-scoped sessionStorage (memory fallback); remove the URL fragment before requests. Media uses separate revocable capability URLs without the API credential.

## 4. Stale Page and Media Session Lifecycle

- **Hazard**: A browser tab left open or navigating between episodes must not leave active media streams dangling or revoke a subsequent playback session.
- **Contract**:
  - Closing an episode dialog or switching titles issues an explicit abort/release.
  - Each media stream has a generation identifier or session token. A release request from a stale page or prior generation cannot revoke or disrupt an active successor session.
- **Observable Proof**:
  - Trigger stream resolve for Title A → generation 1 active.
  - Switch to Title B → generation 2 active; generation 1 stream and gateway aborted.
  - Belated release request with generation 1 token is a harmless no-op; generation 2 continues playing.

## 5. Delayed Native Dialog Close and Reopen

- **Contract**: External player selection and native picker interactions must cleanly handle delayed dialog dismissals and immediate reopenings.
- **Observable Proof**:
  - Close a title and reopen another before the native dialog's queued `close` event fires.
  - Deliver that old event; the reopened dialog, selected title and media remain active.
  - Test by deferring event delivery, without a wall-clock sleep.

## 6. Catalogs Exceeding 1000 Episodes

- **Contract**: High-volume series (e.g. long-running anime or daily shows with 1000+ episodes) must render without DOM freezing, memory leaks, or truncation.
- **Observable Proof**:
  - Fetch catalog with 1100 episodes.
  - Companion API returns full episode list cleanly. Episode 1 and episode 1100 remain selectable; inspect responsiveness separately from unit reachability.
  - Memory consumption stays bounded.

## 7. Selected-Season Retry

- **Contract**: When a transient network error occurs while fetching season episode listings, triggering a retry must preserve the selected season index rather than resetting to Season 1.
- **Observable Proof**:
  - Navigate to Season 4, simulate transient provider failure.
  - UI shows retry button.
  - Clicking retry queries Season 4; on resolution, Season 4 episodes render.

## 8. Real WebVTT Browser Subtitle Tracks

- **Contract**: Browser `<video>` elements require valid WebVTT tracks.
- **Observable Proof**:
  - Companion subtitle gateway serves subtitles with `Content-Type: text/vtt; charset=utf-8`.
  - Body has a validated WebVTT signature and cue content.
  - Providers returning unsupported subtitle formats or binary tracks must return a sanitized non-success response with an honest unsupported format status rather than serving garbage or empty 200 responses to the browser.
