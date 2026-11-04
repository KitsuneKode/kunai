// Web companion HTML application for Kunai
// Follows $apple-design, $mobile-native, $emil-design-eng:
// - 100dvh viewport, safe area insets, touch-action: manipulation
// - No sticky hover on touch devices, no 300ms tap latency
// - 16px minimum font size for input to prevent iOS auto-zoom
// - Standalone PWA manifest support, direct mobile app scheme launchers (VLC, Infuse, Outplayer)

export function renderWebCompanionHtml(options: { readonly serviceName?: string } = {}): string {
  const service = (options.serviceName ?? "Kunai Web Companion")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="Kunai" />
  <meta name="theme-color" content="#181419" />
  <title>${service}</title>
  <link rel="manifest" href="/manifest.json" />
  <style>
    :root {
      --bg: #181419;
      --bg-surface: #231c26;
      --bg-elevated: #2f2533;
      --accent: #ff8fb0;
      --accent-hover: #ff709b;
      --accent-dim: #e27599;
      --accent-fill: rgba(255, 143, 176, 0.12);
      --text: #f5eff8;
      --text-dim: #9f92a4;
      --text-muted: #685e6d;
      --line: rgba(255, 255, 255, 0.08);
      --line-focus: rgba(255, 143, 176, 0.4);
      --radius-sm: 8px;
      --radius-md: 14px;
      --radius-lg: 20px;
      --safe-top: env(safe-area-inset-top, 0px);
      --safe-bottom: env(safe-area-inset-bottom, 12px);
      --safe-left: env(safe-area-inset-left, 0px);
      --safe-right: env(safe-area-inset-right, 0px);
    }
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-tap-highlight-color: transparent;
    }
    html, body {
      width: 100%;
      height: 100dvh;
      min-height: 100dvh;
      background-color: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
      overflow: hidden;
      overscroll-behavior: none;
      touch-action: manipulation;
    }
    #app {
      display: flex;
      flex-direction: column;
      height: 100dvh;
      width: 100%;
      max-width: 1100px;
      margin: 0 auto;
      padding: var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left);
      position: relative;
    }
    /* Header */
    header {
      padding: 12px 16px 8px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      border-bottom: 1px solid var(--line);
      background: rgba(24, 20, 25, 0.85);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      z-index: 10;
    }
    .header-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
      font-size: 1.15rem;
      letter-spacing: -0.02em;
    }
    .brand-icon {
      font-size: 1.3rem;
    }
    .brand-accent {
      color: var(--accent);
    }
    .status-badge {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.78rem;
      color: #48bb78;
      background: rgba(72, 187, 120, 0.12);
      padding: 4px 10px;
      border-radius: 9999px;
      font-weight: 500;
    }
    .pulse-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #48bb78;
      box-shadow: 0 0 6px #48bb78;
    }
    /* Lane Tabs */
    .lane-tabs {
      display: flex;
      gap: 6px;
      overflow-x: auto;
      scrollbar-width: none;
      padding-bottom: 2px;
    }
    .lane-tabs::-webkit-scrollbar {
      display: none;
    }
    .tab-btn {
      appearance: none;
      border: 1px solid var(--line);
      background: var(--bg-surface);
      color: var(--text-dim);
      padding: 6px 14px;
      border-radius: var(--radius-sm);
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.15s ease;
      touch-action: manipulation;
    }
    @media (hover: hover) and (pointer: fine) {
      .tab-btn:hover {
        background: var(--bg-elevated);
        color: var(--text);
        border-color: rgba(255, 255, 255, 0.15);
      }
    }
    .tab-btn.active {
      background: var(--accent-fill);
      color: var(--accent);
      border-color: var(--accent-dim);
    }
    /* Search Bar */
    .search-wrap {
      display: flex;
      position: relative;
      width: 100%;
    }
    .search-input {
      width: 100%;
      background: var(--bg-surface);
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      color: var(--text);
      font-size: 16px; /* Essential: prevents iOS Safari auto-zoom */
      padding: 10px 14px 10px 38px;
      outline: none;
      transition: border-color 0.15s ease, background-color 0.15s ease;
    }
    .search-input:focus {
      border-color: var(--line-focus);
      background: var(--bg-elevated);
    }
    .search-icon {
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-muted);
      pointer-events: none;
      font-size: 0.95rem;
    }
    .search-clear {
      position: absolute;
      right: 12px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 1.1rem;
      display: none;
      padding: 4px;
    }
    /* Main Content Area */
    main {
      flex: 1;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      padding: 16px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 14px;
    }
    @media (min-width: 640px) {
      .grid {
        grid-template-columns: repeat(3, 1fr);
      }
    }
    @media (min-width: 900px) {
      .grid {
        grid-template-columns: repeat(4, 1fr);
      }
    }
    .card {
      background: var(--bg-surface);
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      cursor: pointer;
      transition: transform 0.15s ease, border-color 0.15s ease;
      touch-action: manipulation;
    }
    @media (hover: hover) and (pointer: fine) {
      .card:hover {
        transform: translateY(-2px);
        border-color: var(--line-focus);
      }
    }
    .card:active {
      transform: scale(0.98);
    }
    .poster-wrap {
      width: 100%;
      aspect-ratio: 2 / 3;
      background: var(--bg-elevated);
      position: relative;
      overflow: hidden;
    }
    .card-video .poster-wrap { aspect-ratio: 16 / 9; }
    .poster-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .poster-fallback {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
      font-size: 2.2rem;
    }
    .card-info {
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      flex: 1;
    }
    .card-title {
      font-size: 0.92rem;
      font-weight: 600;
      color: var(--text);
      line-height: 1.25;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .card-meta {
      font-size: 0.78rem;
      color: var(--text-dim);
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: auto;
    }
    .badge {
      background: var(--accent-fill);
      color: var(--accent);
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 600;
      font-size: 0.72rem;
    }
    /* Empty & Loading States */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 48px 16px;
      color: var(--text-dim);
      text-align: center;
      gap: 12px;
    }
    .empty-icon {
      font-size: 3rem;
      opacity: 0.6;
    }
    .lane-chips {
      display: flex;
      gap: 8px;
      margin-top: 14px;
      flex-wrap: wrap;
      justify-content: center;
    }
    .lane-chip {
      background: var(--surface-hover);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 6px 14px;
      color: var(--text);
      font-size: 0.8rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
    }
    .lane-chip:hover {
      background: rgba(255, 143, 176, 0.15);
      border-color: var(--accent);
    }
    .player-error-overlay {
      position: absolute;
      inset: 0;
      background: rgba(18, 19, 26, 0.94);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 16px;
      z-index: 10;
      text-align: center;
      border-radius: var(--radius-sm);
    }
    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid rgba(255, 143, 176, 0.2);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    /* Sheet / Modal */
    .sheet-overlay {
      inset: 0;
      margin: auto auto 0;
      padding: 0;
      width: min(100%, 580px);
      max-width: 100%;
      max-height: 85dvh;
      border: none;
      background: transparent;
      color: var(--text);
    }
    .sheet-overlay:modal { overscroll-behavior: contain; }
    .sheet-overlay::backdrop {
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(8px);
      overflow: hidden;
      overscroll-behavior: contain;
    }
    @media (min-width: 640px) { .sheet-overlay { margin: auto; } }
    .sheet {
      width: 100%;
      max-width: 580px;
      background: var(--bg-surface);
      border: 1px solid var(--line);
      border-radius: var(--radius-lg) var(--radius-lg) 0 0;
      max-height: 85dvh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: slideUp 0.22s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @media (min-width: 640px) {
      .sheet {
        border-radius: var(--radius-lg);
        max-height: 80dvh;
      }
    }
    @keyframes slideUp {
      from { transform: translateY(100%); }
      to { transform: translateY(0); }
    }
    .sheet-header {
      padding: 16px;
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .sheet-title {
      font-size: 1.1rem;
      font-weight: 700;
      color: var(--text);
    }
    .close-btn {
      appearance: none;
      background: var(--bg-elevated);
      border: none;
      color: var(--text-dim);
      width: 32px;
      height: 32px;
      border-radius: 50%;
      font-size: 1.1rem;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .sheet-body {
      padding: 16px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    /* Action Buttons inside Sheet */
    .launchers {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
    }
    .launch-btn {
      appearance: none;
      border: 1px solid var(--line);
      background: var(--bg-elevated);
      color: var(--text);
      padding: 12px 14px;
      border-radius: var(--radius-md);
      font-size: 0.88rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.15s ease;
      touch-action: manipulation;
    }
    .launch-btn.primary {
      background: var(--accent);
      color: #181419;
      border-color: var(--accent);
      grid-column: span 2;
      font-size: 0.96rem;
    }
    @media (hover: hover) and (pointer: fine) {
      .launch-btn:hover {
        border-color: var(--accent-dim);
      }
      .launch-btn.primary:hover {
        background: var(--accent-hover);
      }
    }
    /* Episodes list inside sheet */
    .episodes-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 240px;
      overflow-y: auto;
    }
    .episode-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: var(--bg-elevated);
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      padding: 10px 12px;
      cursor: pointer;
      font-size: 0.88rem;
      touch-action: manipulation;
    }
    .episode-item.active {
      border-color: var(--accent);
      background: var(--accent-fill);
      color: var(--accent);
      font-weight: 600;
    }
    /* In-Browser Video Player */
    .video-wrap {
      width: 100%;
      aspect-ratio: 16 / 9;
      background: #000;
      border-radius: var(--radius-md);
      overflow: hidden;
      position: relative;
    }
    video {
      width: 100%;
      height: 100%;
      display: block;
    }
    /* Remote Controller Tab */
    .remote-panel {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 24px;
      padding: 32px 16px;
      max-width: 420px;
      margin: 0 auto;
    }
    .remote-dpad {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      width: 100%;
    }
    .remote-btn {
      appearance: none;
      background: var(--bg-surface);
      border: 1px solid var(--line);
      color: var(--text);
      padding: 16px;
      border-radius: var(--radius-md);
      font-size: 1.1rem;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      touch-action: manipulation;
    }
    .remote-btn:active {
      background: var(--accent-fill);
      color: var(--accent);
      transform: scale(0.96);
    }
    .remote-btn.big {
      background: var(--accent);
      color: #181419;
      border-color: var(--accent);
    }
    /* Status Table */
    .status-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.88rem;
    }
    .status-table th, .status-table td {
      padding: 10px 12px;
      text-align: left;
      border-bottom: 1px solid var(--line);
    }
    .status-table th {
      color: var(--text-muted);
      font-weight: 600;
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    button, input, a { font-family: inherit; }
    button { min-block-size: 44px; }
    .card { text-align: left; width: 100%; color: var(--text); }
    .poster-wrap { display: block; }
    .search-clear, .close-btn { min-width: 44px; min-height: 44px; }
    :where(button, input, a):focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
    button:disabled { opacity: 0.5; cursor: default; }
    .status-badge { color: var(--text-dim); background: var(--bg-elevated); max-width: 65%; }
    .pulse-dot { display: none; }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
  </style>
</head>
<body>
  <div id="app">
    <header>
      <div class="header-top">
        <h1 class="brand">
          <span class="brand-icon">🦊</span>
          <span>Kunai <span class="brand-accent">Web</span></span>
        </h1>
        <div class="status-badge" id="connStatus" role="status" aria-live="polite">
          <span class="pulse-dot"></span>
          <span id="connText">Connecting…</span>
        </div>
      </div>
      <nav class="lane-tabs" aria-label="Browse modes">
        <button class="tab-btn active" data-tab="anime">Anime</button>
        <button class="tab-btn" data-tab="series">Shows</button>
        <button class="tab-btn" data-tab="movies">Movies</button>
        <button class="tab-btn" data-tab="youtube">YouTube</button>
        <button class="tab-btn" data-tab="remote">Remote Control</button>
        <button class="tab-btn" data-tab="status">Providers</button>
      </nav>
      <div class="search-wrap" id="searchBar">
        <span class="search-icon">⌕</span>
        <input
          type="search"
          aria-label="Search titles"
          maxlength="200"
          class="search-input"
          id="searchInput"
          placeholder="Search anime, movies, series..."
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          spellcheck="false"
        />
        <button class="search-clear" id="searchClear" aria-label="Clear search">×</button>
      </div>
    </header>

    <main id="mainContent">
      <div class="grid" id="resultsGrid"></div>
      <div class="empty-state" id="emptyState" role="status">
        <div class="empty-icon">🌸</div>
        <div style="font-weight: 600; color: var(--text);">Ready to watch</div>
        <div style="font-size: 0.85rem;">Type a title above or tap a lane tab to browse.</div>
      </div>
      <div class="empty-state" id="loadingState" style="display: none;">
        <div class="spinner"></div>
        <div style="font-size: 0.85rem;">Searching providers...</div>
      </div>
    </main>

    <!-- Modal Sheet -->
    <dialog class="sheet-overlay" id="sheetOverlay" aria-labelledby="sheetTitle">
      <div class="sheet">
        <div class="sheet-header">
          <h2 class="sheet-title" id="sheetTitle">Title</h2>
          <button class="close-btn" id="sheetClose" aria-label="Close title" autofocus>✕</button>
        </div>
        <div class="sheet-body" id="sheetBody">
          <div class="video-wrap" id="videoWrap" style="display: none; position: relative;">
            <video id="player" controls playsinline crossorigin="anonymous"></video>
            <div id="playerErrorOverlay" class="player-error-overlay" style="display: none;">
              <div style="font-size: 2rem; margin-bottom: 6px;">⚠️</div>
              <div style="font-weight: 700; font-size: 0.95rem; color: #fff;" id="playerErrorTitle">Playback Interrupted</div>
              <div style="font-size: 0.8rem; color: var(--text-dim); margin-top: 4px; max-width: 290px;" id="playerErrorDetail">This browser could not decode the stream. Try Open in VLC or Play on this device.</div>
            </div>
          </div>
          <div class="launchers" id="launchersBar">
            <button class="launch-btn primary" id="streamBrowserBtn">▶ Stream in Browser</button>
            <a class="launch-btn" id="openVlcBtn" style="display: none;">⚡ Open in VLC</a>
            <button class="launch-btn" id="castHostBtn" style="grid-column: span 2;">🖥️ Play on this device</button>
          </div>
          <p id="sheetStatus" role="status" aria-live="polite"></p>
          <h3 style="font-weight: 600; font-size: 0.9rem; margin-top: 6px;" id="episodesHeading">Episodes</h3>
          <div class="episodes-list" id="episodesList"></div>
        </div>
      </div>
    </dialog>
  </div>

  <script>
    (function() {
      "use strict";
      var activeTab = "anime";
      var queries = { anime: "", series: "", movies: "", youtube: "" };
      var activeItem = null;
      var activeEpisode = null;
      var searchTimeout;
      var searchVersion = 0;
      var sheetVersion = 0;
      var streamVersion = 0;
      var viewVersion = 0;
      var searchController;
      var episodeController;
      var streamController;
      var controlController;
      var releasePromise = Promise.resolve();
      var controls = [];
      var tabButtons = document.querySelectorAll(".tab-btn");
      function el(id) { return document.getElementById(id); }
      var searchInput = el("searchInput");
      var resultsGrid = el("resultsGrid");
      var emptyState = el("emptyState");
      var loadingState = el("loadingState");
      var sheet = el("sheetOverlay");
      var episodesList = el("episodesList");
      var player = el("player");
      var browserButton = el("streamBrowserBtn");
      var desktopButton = el("castHostBtn");
      var vlcLink = el("openVlcBtn");
      var sheetStatus = el("sheetStatus");
      var reconnect = "Session expired. Reopen the companion URL printed by Kunai.";
      function text(value, limit) { return typeof value === "string" ? value.slice(0, limit || 500) : ""; }
      function node(tag, className, value) {
        var element = document.createElement(tag);
        if (className) element.className = className;
        if (value !== undefined) element.textContent = String(value);
        return element;
      }
      function button(label, callback, className) {
        var element = node("button", className || "launch-btn", label);
        element.type = "button";
        element.addEventListener("click", callback);
        return element;
      }
      function errorMessage(error) { return text(error && error.message) || "Request failed. Try again."; }
      function failed(error) { return error && error.name === "AbortError"; }
      function connection(message) { el("connText").textContent = message; }
      async function responseData(response) {
        if (response.status === 403) { connection(reconnect); throw new Error(reconnect); }
        var data;
        try { data = await response.json(); } catch (_) { throw new Error("Invalid server response. Try again."); }
        if (!response.ok) throw new Error(text(data.error) || text(data.reason) || "Request failed. Try again.");
        return data;
      }
      // Fragments are not sent to the server. Remove the one-time secret before
      // any requests, media or external links can expose the current page URL.
      var token = new URLSearchParams(window.location.hash.slice(1)).get("token");
      if (window.location.hash) history.replaceState(null, "", window.location.pathname + window.location.search);
      var authentication = (async function() {
        if (token !== null) {
          if (!/^[a-f0-9]{32}$/i.test(token)) throw new Error(reconnect);
          await responseData(await fetch("/api/session", {
            method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: token })
          }));
          token = null;
        }
      })();
      authentication.catch(function(error) { token = null; connection(errorMessage(error)); });
      async function api(path, options) {
        await authentication;
        if (options && options.signal && options.signal.aborted) throw new DOMException("Canceled", "AbortError");
        return responseData(await fetch(path, Object.assign({ credentials: "same-origin" }, options || {})));
      }
      function post(path, body, signal) {
        return api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: signal });
      }
      function httpUrl(value, gateway) {
        if (typeof value !== "string" || value.length > 8192) return "";
        try {
          var url = new URL(value, window.location.origin);
          if (!/^https?:$/.test(url.protocol) || url.username || url.password) return "";
          if (gateway && (url.protocol !== "http:" || url.hostname !== "127.0.0.1")) return "";
          return url.href;
        } catch (_) { return ""; }
      }
      function resetLaunchers() {
        browserButton.disabled = true;
        browserButton.onclick = null;
        desktopButton.disabled = true;
        vlcLink.removeAttribute("href");
        vlcLink.style.display = "none";
        player.pause();
        player.removeAttribute("src");
        player.replaceChildren();
        player.load();
        el("videoWrap").style.display = "none";
        el("playerErrorOverlay").style.display = "none";
      }
      function cancelStream() {
        streamVersion++;
        if (streamController) streamController.abort();
        if (controlController) controlController.abort();
        resetLaunchers();
        // Serialize revocation before another resolution; server also guards
        // canceled generations so late provider work cannot resurrect a URL.
        releasePromise = releasePromise.then(function() { return post("/api/release", {}); }).catch(function(error) {
          if (!failed(error)) connection(errorMessage(error));
        });
      }
      function cleanupSheet() {
        sheetVersion++;
        if (episodeController) episodeController.abort();
        if (activeItem) cancelStream();
        activeItem = null;
        activeEpisode = null;
      }
      sheet.addEventListener("close", cleanupSheet);
      el("sheetClose").addEventListener("click", function() { sheet.close(); });
      function closeSheet() { if (sheet.open) sheet.close(); else cleanupSheet(); }
      player.addEventListener("error", function() {
        if (!player.src) return;
        el("playerErrorOverlay").style.display = "flex";
        el("playerErrorDetail").textContent = "This browser could not decode the stream. Try Open in VLC or Play on this device.";
      });
      player.addEventListener("playing", function() {
        el("playerErrorOverlay").style.display = "none";
        sheetStatus.textContent = "Playing in browser.";
      });
      function empty(message, retry) {
        emptyState.replaceChildren(node("p", "", message));
        if (retry) emptyState.appendChild(button("Retry", retry));
        emptyState.style.display = "flex";
        loadingState.style.display = "none";
      }
      function invalidateSearch() {
        searchVersion++;
        clearTimeout(searchTimeout);
        if (searchController) searchController.abort();
      }
      async function performSearch(query) {
        invalidateSearch();
        var version = searchVersion;
        var lane = activeTab;
        resultsGrid.replaceChildren();
        if (query.length < 2) { empty("Type at least two characters to search."); return; }
        emptyState.style.display = "none";
        loadingState.style.display = "flex";
        searchController = new AbortController();
        try {
          var data = await api("/api/search?q=" + encodeURIComponent(query.slice(0, 200)) + "&lane=" + lane, { signal: searchController.signal });
          if (version !== searchVersion || lane !== activeTab) return;
          loadingState.style.display = "none";
          if (!Array.isArray(data.results)) throw new Error("Invalid search response.");
          var items = data.results.slice(0, 60).filter(function(item) { return item && typeof item.id === "string" && typeof item.title === "string"; });
          if (!items.length) { empty("No results in " + lane + ". Try another title or mode."); return; }
          connection(items.length + " results");
          items.forEach(function(item) {
            var card = button("", function() { openItem(item); }, lane === "youtube" ? "card card-video" : "card");
            var poster = node("span", "poster-wrap");
            var posterUrl = httpUrl(item.posterUrl, false);
            if (posterUrl) {
              var image = node("img", "poster-img");
              image.src = posterUrl; image.alt = ""; image.loading = "lazy"; image.referrerPolicy = "no-referrer";
              image.addEventListener("error", function() { image.remove(); poster.appendChild(node("span", "poster-fallback", "🎬")); });
              poster.appendChild(image);
            } else poster.appendChild(node("span", "poster-fallback", "🎬"));
            card.appendChild(poster);
            var info = node("span", "card-info");
            info.appendChild(node("span", "card-title", text(item.title, 300)));
            var meta = node("span", "card-meta");
            meta.appendChild(node("span", "", lane === "youtube" ? "Video" : (item.year ? String(item.year) : text(item.type, 30))));
            meta.appendChild(node("span", "badge", text(item.providerId, 60) || lane));
            info.appendChild(meta); card.appendChild(info); resultsGrid.appendChild(card);
          });
        } catch (error) {
          if (version !== searchVersion || failed(error)) return;
          empty(errorMessage(error), function() { performSearch(query); });
        }
      }
      function updateQuery() {
        invalidateSearch(); closeSheet();
        var query = searchInput.value.slice(0, 200);
        queries[activeTab] = query;
        el("searchClear").style.display = query.length ? "block" : "none";
        resultsGrid.replaceChildren();
        loadingState.style.display = "none";
        if (query.trim().length < 2) empty("Type at least two characters to search.");
        else searchTimeout = setTimeout(function() { performSearch(query.trim()); }, 320);
      }
      searchInput.addEventListener("input", updateQuery);
      el("searchClear").addEventListener("click", function() { searchInput.value = ""; updateQuery(); searchInput.focus(); });
      tabButtons.forEach(function(tab) {
        tab.addEventListener("click", function() {
          invalidateSearch(); closeSheet(); viewVersion++;
          activeTab = tab.getAttribute("data-tab");
          tabButtons.forEach(function(item) { var chosen = item === tab; item.classList.toggle("active", chosen); item.setAttribute("aria-pressed", String(chosen)); });
          resultsGrid.replaceChildren(); loadingState.style.display = "none"; emptyState.style.display = "none";
          var catalog = Object.prototype.hasOwnProperty.call(queries, activeTab);
          el("searchBar").style.display = catalog ? "flex" : "none";
          if (catalog) {
            searchInput.value = queries[activeTab];
            el("searchClear").style.display = searchInput.value ? "block" : "none";
            performSearch(searchInput.value.trim());
          } else renderStatus(activeTab === "remote");
        });
      });
      async function openItem(item) {
        closeSheet();
        activeItem = item;
        activeEpisode = null;
        var version = ++sheetVersion;
        var lane = activeTab;
        el("sheetTitle").textContent = text(item.title, 300);
        sheetStatus.textContent = "";
        resetLaunchers();
        sheet.showModal();
        await loadEpisodes(item, lane, version);
      }
      async function loadEpisodes(item, lane, version, season) {
        if (season !== undefined) cancelStream();
        if (episodeController) episodeController.abort();
        episodeController = new AbortController();
        episodesList.replaceChildren(node("p", "", "Loading episodes…"));
        try {
          var data = await api("/api/episodes?id=" + encodeURIComponent(item.id) + "&lane=" + lane + "&season=" + (season || 1), { signal: episodeController.signal });
          if (version !== sheetVersion || activeItem !== item) return;
          if (!Array.isArray(data.episodes)) throw new Error("Invalid episode response.");
          var episodes = data.episodes.slice(0, 1000).filter(function(ep) { return ep && Number.isFinite(ep.number) && ep.number > 0 && (ep.season === undefined || Number.isInteger(ep.season) && ep.season > 0); });
          episodesList.replaceChildren();
          var oldSeasons = el("seasonPicker");
          if (oldSeasons) oldSeasons.remove();
          if (Array.isArray(data.seasons) && data.seasons.length > 1) {
            var picker = node("select"); picker.id = "seasonPicker"; picker.setAttribute("aria-label", "Season");
            data.seasons.filter(function(value) { return Number.isInteger(value) && value > 0; }).forEach(function(value) {
              var option = node("option", "", "Season " + value); option.value = String(value); picker.appendChild(option);
            });
            picker.value = String(episodes[0] && episodes[0].season || season || 1);
            picker.addEventListener("change", function() { loadEpisodes(item, lane, version, Number(picker.value)); });
            episodesList.before(picker);
          }
          if (!episodes.length) { episodesList.appendChild(node("p", "", "No playable episodes returned.")); return; }
          episodes.forEach(function(ep) {
            var label = lane === "movies" || lane === "youtube" ? "Play Title" : (ep.season ? "Season " + ep.season + " · " : "") + "Episode " + ep.number;
            var row = button(label + (ep.title && ep.title !== "Play Title" ? " · " + text(ep.title, 300) : ""), function() { selectEpisode(item, ep, lane); }, "episode-item");
            row.setAttribute("aria-pressed", "false");
            row.addEventListener("click", function() { episodesList.children && Array.from(episodesList.children).forEach(function(child) { child.classList.toggle("active", child === row); child.setAttribute("aria-pressed", String(child === row)); }); });
            episodesList.appendChild(row);
          });
          episodesList.children[0].classList.add("active");
          episodesList.children[0].setAttribute("aria-pressed", "true");
          selectEpisode(item, episodes[0], lane);
        } catch (error) {
          if (version !== sheetVersion || failed(error)) return;
          episodesList.replaceChildren(node("p", "", errorMessage(error)), button("Retry episodes", function() { loadEpisodes(item, lane, version); }));
        }
      }
      async function selectEpisode(item, episode, lane) {
        cancelStream();
        activeEpisode = episode;
        var version = streamVersion;
        var titleVersion = sheetVersion;
        desktopButton.disabled = !controls.includes("play");
        sheetStatus.textContent = "Resolving episode…";
        streamController = new AbortController();
        var signal = streamController.signal;
        try {
          await releasePromise;
          if (version !== streamVersion) return;
          var data = await api("/api/stream?titleId=" + encodeURIComponent(item.id) + "&episode=" + episode.number + "&season=" + (episode.season || 1) + "&lane=" + lane, { signal: signal });
          if (version !== streamVersion || titleVersion !== sheetVersion) return;
          var url = httpUrl(data.streamUrl, true);
          if (!data.ok || !url) { sheetStatus.textContent = text(data.reason) || "Browser stream unavailable. Use Play on this device."; return; }
          vlcLink.href = "vlc://" + url;
          vlcLink.style.display = "flex";
          var subtitles = Array.isArray(data.subtitleUrls) ? data.subtitleUrls.slice(0, 20).map(function(value) { return httpUrl(value, true); }).filter(Boolean) : [];
          browserButton.disabled = data.browserPlayable !== true;
          sheetStatus.textContent = data.browserPlayable === true ? "Stream ready. Choose a player." : text(data.reason) || "Browser format unsupported. Open in VLC or play on this device.";
          browserButton.onclick = async function() {
            if (version !== streamVersion || browserButton.disabled) return;
            el("videoWrap").style.display = "block";
            player.src = url;
            player.replaceChildren();
            subtitles.forEach(function(subtitle, index) {
              var track = node("track"); track.src = subtitle; track.kind = "subtitles"; track.label = "Subtitle " + (index + 1); player.appendChild(track);
            });
            try { await player.play(); } catch (_) {
              if (version === streamVersion) sheetStatus.textContent = "Browser playback did not start. Try the video controls, Open in VLC or Play on this device.";
            }
          };
        } catch (error) {
          if (version === streamVersion && !failed(error)) {
            sheetStatus.textContent = errorMessage(error) + " You can also try Play on this device.";
            episodesList.appendChild(button("Retry stream", function() { if (activeItem === item) selectEpisode(item, episode, lane); }));
          }
        }
      }
      desktopButton.addEventListener("click", async function() {
        if (!activeItem || !activeEpisode || desktopButton.disabled) return;
        var version = sheetVersion;
        var stream = streamVersion;
        desktopButton.disabled = true;
        controlController = new AbortController();
        sheetStatus.textContent = "Starting local player…";
        try {
          var data = await post("/api/control", { action: "play", titleId: activeItem.id, episode: activeEpisode.number, season: activeEpisode.season || 1, lane: activeTab }, controlController.signal);
          if (version !== sheetVersion || stream !== streamVersion) return;
          if (!data.ok) throw new Error(text(data.error) || "Player did not accept playback.");
          sheetStatus.textContent = "Playback accepted by the local player. Check Remote Control for current state.";
        } catch (error) { if (version === sheetVersion && stream === streamVersion && !failed(error)) sheetStatus.textContent = errorMessage(error); }
        finally { if (version === sheetVersion && stream === streamVersion) desktopButton.disabled = !controls.includes("play"); }
      });
      async function renderStatus(remote) {
        var version = viewVersion;
        resultsGrid.replaceChildren(node("p", "", "Loading local status…"));
        try {
          var data = await api("/api/status");
          if (version !== viewVersion) return;
          controls = Array.isArray(data.controls) ? data.controls : [];
          resultsGrid.replaceChildren();
          var panel = node("div", "remote-panel"); panel.style.gridColumn = "1 / -1";
          if (remote) {
            panel.appendChild(node("h2", "", "Local player"));
            var state = data.playback || {};
            panel.appendChild(node("p", "", "State: " + text(state.state, 40) + (state.title ? " · " + text(state.title, 300) : "")));
            if (state.error) panel.appendChild(node("p", "", text(state.error)));
            if (controls.includes("stop")) panel.appendChild(button(state.state === "starting" ? "Cancel startup" : "Stop playback", async function() {
              try { var result = await post("/api/control", { action: "stop" }); if (!result.ok) throw new Error(text(result.error) || "Stop was not accepted."); if (version === viewVersion) renderStatus(true); }
              catch (error) { if (version === viewVersion) panel.appendChild(node("p", "", errorMessage(error))); }
            }));
            panel.appendChild(node("p", "", "Pause, seek, volume, subtitles and next episode are unavailable here. Use the player controls."));
          } else {
            panel.appendChild(node("h2", "", "Configured providers"));
            panel.appendChild(node("p", "", "Health is unknown until an actual search or stream is attempted."));
            (Array.isArray(data.providers) ? data.providers : []).slice(0, 100).forEach(function(provider) {
              panel.appendChild(node("p", "", text(provider.name, 100) + " · " + text(provider.lane, 30) + " · " + (provider.enabled ? "enabled" : "disabled") + " · health unknown"));
            });
          }
          panel.appendChild(button("Refresh status", function() { renderStatus(remote); }));
          resultsGrid.appendChild(panel);
        } catch (error) {
          if (version === viewVersion) { resultsGrid.replaceChildren(); empty(errorMessage(error), function() { renderStatus(remote); }); }
        }
      }
      resetLaunchers();
      api("/api/status").then(function(data) {
        controls = Array.isArray(data.controls) ? data.controls : [];
        connection("Connected locally");
        if (activeItem && activeEpisode) desktopButton.disabled = !controls.includes("play");
      }).catch(function(error) { connection(errorMessage(error)); });
    })();
  </script>
</body>
</html>
`;
}
