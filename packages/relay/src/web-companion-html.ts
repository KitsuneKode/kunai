// Web companion HTML application for Kunai
// Follows $apple-design, $mobile-native, $emil-design-eng:
// - 100dvh viewport, safe area insets, touch-action: manipulation
// - No sticky hover on touch devices, no 300ms tap latency
// - 16px minimum font size for input to prevent iOS auto-zoom
// - Standalone PWA manifest support, direct mobile app scheme launchers (VLC, Infuse, Outplayer)

export function renderWebCompanionHtml(options: { readonly serviceName?: string } = {}): string {
  const service = options.serviceName ?? "Kunai Web Companion";
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
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      z-index: 100;
      display: none;
      justify-content: center;
      align-items: flex-end;
    }
    @media (min-width: 640px) {
      .sheet-overlay {
        align-items: center;
      }
    }
    .sheet-overlay.active {
      display: flex;
    }
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
  </style>
</head>
<body>
  <div id="app">
    <header>
      <div class="header-top">
        <div class="brand">
          <span class="brand-icon">🦊</span>
          <span>Kunai <span class="brand-accent">Web</span></span>
        </div>
        <div class="status-badge" id="connStatus">
          <span class="pulse-dot"></span>
          <span id="connText">Ready</span>
        </div>
      </div>
      <div class="lane-tabs">
        <button class="tab-btn active" data-tab="anime">Anime</button>
        <button class="tab-btn" data-tab="series">Shows & Movies</button>
        <button class="tab-btn" data-tab="youtube">YouTube</button>
        <button class="tab-btn" data-tab="remote">Remote Control</button>
        <button class="tab-btn" data-tab="status">Providers</button>
      </div>
      <div class="search-wrap" id="searchBar">
        <span class="search-icon">⌕</span>
        <input
          type="text"
          class="search-input"
          id="searchInput"
          placeholder="Search anime, movies, series..."
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          spellcheck="false"
        />
        <button class="search-clear" id="searchClear">×</button>
      </div>
    </header>

    <main id="mainContent">
      <div class="grid" id="resultsGrid"></div>
      <div class="empty-state" id="emptyState">
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
    <div class="sheet-overlay" id="sheetOverlay">
      <div class="sheet">
        <div class="sheet-header">
          <div class="sheet-title" id="sheetTitle">Title</div>
          <button class="close-btn" id="sheetClose">✕</button>
        </div>
        <div class="sheet-body" id="sheetBody">
          <div class="video-wrap" id="videoWrap" style="display: none; position: relative;">
            <video id="player" controls playsinline></video>
            <div id="playerErrorOverlay" class="player-error-overlay" style="display: none;">
              <div style="font-size: 2rem; margin-bottom: 6px;">⚠️</div>
              <div style="font-weight: 700; font-size: 0.95rem; color: #fff;" id="playerErrorTitle">Playback Interrupted</div>
              <div style="font-size: 0.8rem; color: var(--text-dim); margin-top: 4px; max-width: 290px;" id="playerErrorDetail">Direct browser stream dropped or codec unsupported. Try an external player or route via Relay Proxy:</div>
              <div style="display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; justify-content: center;">
                <button class="launch-btn primary" id="retryProxyBtn" style="padding: 6px 12px; font-size: 0.8rem;">🔄 Stream via Relay Proxy</button>
                <a class="launch-btn" id="errVlcBtn" href="#" style="padding: 6px 12px; font-size: 0.8rem;">⚡ Open in VLC</a>
                <a class="launch-btn" id="errInfuseBtn" href="#" style="padding: 6px 12px; font-size: 0.8rem;">🎬 Open in Infuse</a>
              </div>
            </div>
          </div>
          <div class="launchers" id="launchersBar">
            <button class="launch-btn primary" id="streamBrowserBtn">▶ Stream in Browser</button>
            <a class="launch-btn" id="openVlcBtn" href="#">⚡ Open in VLC</a>
            <a class="launch-btn" id="openInfuseBtn" href="#">⚡ Open in Infuse</a>
            <button class="launch-btn" id="castHostBtn" style="grid-column: span 2;">🖥️ Play on Desktop Terminal</button>
          </div>
          <div style="font-weight: 600; font-size: 0.9rem; margin-top: 6px;" id="episodesHeading">Episodes</div>
          <div class="episodes-list" id="episodesList"></div>
        </div>
      </div>
    </div>
  </div>

  <script>
    (function() {
      var activeTab = "anime";
      var currentResults = [];
      var activeItem = null;
      var activeEpisode = 1;
      var searchTimeout = null;

      var tabButtons = document.querySelectorAll(".tab-btn");
      var searchInput = document.getElementById("searchInput");
      var searchClear = document.getElementById("searchClear");
      var searchBar = document.getElementById("searchBar");
      var resultsGrid = document.getElementById("resultsGrid");
      var emptyState = document.getElementById("emptyState");
      var loadingState = document.getElementById("loadingState");
      var sheetOverlay = document.getElementById("sheetOverlay");
      var sheetClose = document.getElementById("sheetClose");
      var sheetTitle = document.getElementById("sheetTitle");
      var episodesList = document.getElementById("episodesList");
      var streamBrowserBtn = document.getElementById("streamBrowserBtn");
      var openVlcBtn = document.getElementById("openVlcBtn");
      var openInfuseBtn = document.getElementById("openInfuseBtn");
      var castHostBtn = document.getElementById("castHostBtn");
      var videoWrap = document.getElementById("videoWrap");
      var player = document.getElementById("player");

      // Switch tab
      tabButtons.forEach(function(btn) {
        btn.addEventListener("click", function() {
          tabButtons.forEach(function(b) { b.classList.remove("active"); });
          btn.classList.add("active");
          activeTab = btn.getAttribute("data-tab");
          if (activeTab === "remote") {
            renderRemoteView();
          } else if (activeTab === "status") {
            renderStatusView();
          } else {
            searchBar.style.display = "flex";
            if (searchInput.value.trim().length > 0) {
              performSearch(searchInput.value.trim());
            } else {
              resultsGrid.innerHTML = "";
              emptyState.style.display = "flex";
            }
          }
        });
      });

      searchInput.addEventListener("input", function() {
        var query = searchInput.value.trim();
        searchClear.style.display = query.length > 0 ? "block" : "none";
        clearTimeout(searchTimeout);
        if (query.length < 2) {
          resultsGrid.innerHTML = "";
          emptyState.style.display = "flex";
          loadingState.style.display = "none";
          return;
        }
        searchTimeout = setTimeout(function() {
          performSearch(query);
        }, 320);
      });

      var playerErrorOverlay = document.getElementById("playerErrorOverlay");
      var retryProxyBtn = document.getElementById("retryProxyBtn");
      var errVlcBtn = document.getElementById("errVlcBtn");
      var errInfuseBtn = document.getElementById("errInfuseBtn");

      function hidePlayerError() {
        if (playerErrorOverlay) playerErrorOverlay.style.display = "none";
      }

      function showPlayerError(title, detail) {
        if (!playerErrorOverlay) return;
        playerErrorOverlay.style.display = "flex";
        if (title) document.getElementById("playerErrorTitle").innerText = title;
        if (detail) document.getElementById("playerErrorDetail").innerText = detail;
      }

      player.addEventListener("playing", hidePlayerError);
      player.addEventListener("error", function() {
        showPlayerError("Stream Dropped", "Browser direct decode failed. Retry via Relay Proxy or open in VLC.");
      });

      searchClear.addEventListener("click", function() {
        searchInput.value = "";
        searchClear.style.display = "none";
        resultsGrid.innerHTML = "";
        emptyState.style.display = "flex";
        searchInput.focus();
      });

      sheetClose.addEventListener("click", function() {
        sheetOverlay.classList.remove("active");
        player.pause();
        player.src = "";
        hidePlayerError();
        videoWrap.style.display = "none";
      });

      function performSearch(query) {
        emptyState.style.display = "none";
        loadingState.style.display = "flex";
        resultsGrid.innerHTML = "";

        fetch("/api/search?q=" + encodeURIComponent(query) + "&lane=" + encodeURIComponent(activeTab))
          .then(function(r) { return r.json(); })
          .then(function(data) {
            loadingState.style.display = "none";
            currentResults = data.results || [];
            if (currentResults.length === 0) {
              emptyState.style.display = "flex";
              var otherLanes = [
                { id: "anime", label: "🌸 Anime" },
                { id: "movies", label: "🎬 Movies" },
                { id: "series", label: "📺 Series" },
                { id: "youtube", label: "▶ YouTube" },
              ].filter(function(l) { return l.id !== activeTab; });

              var chipsHtml = otherLanes.map(function(l) {
                return '<button class="lane-chip" data-lane="' + l.id + '">' + l.label + '</button>';
              }).join("");

              emptyState.innerHTML =
                '<div class="empty-icon">🔍</div>' +
                '<div style="font-weight:700;color:var(--text);font-size:1.05rem;">No results in ' + activeTab.toUpperCase() + '</div>' +
                '<div style="font-size:0.85rem;color:var(--text-dim);max-width:320px;">Could not find matches for "' + query + '". Try searching in another category:</div>' +
                '<div class="lane-chips">' + chipsHtml + '</div>';

              emptyState.querySelectorAll(".lane-chip").forEach(function(btn) {
                btn.addEventListener("click", function() {
                  var targetLane = btn.getAttribute("data-lane");
                  if (targetLane) {
                    activeTab = targetLane;
                    tabs.forEach(function(t) {
                      t.classList.toggle("active", t.getAttribute("data-tab") === activeTab);
                    });
                    performSearch(query);
                  }
                });
              });
              return;
            }
            renderResults(currentResults);
          })
          .catch(function() {
            loadingState.style.display = "none";
            emptyState.style.display = "flex";
            emptyState.innerHTML = '<div class="empty-icon">⚠️</div><div style="font-weight:600;">Search failed</div><div style="font-size:0.85rem;">Check provider connection.</div>';
          });
      }

      function renderResults(items) {
        resultsGrid.innerHTML = "";
        items.forEach(function(item, idx) {
          var card = document.createElement("div");
          card.className = "card";
          var posterHtml = item.posterUrl
            ? '<img class="poster-img" src="' + item.posterUrl + '" alt="" loading="lazy" />'
            : '<div class="poster-fallback">🎬</div>';
          card.innerHTML =
            '<div class="poster-wrap">' + posterHtml + '</div>' +
            '<div class="card-info">' +
              '<div class="card-title">' + (item.title || item.name || "Untitled") + '</div>' +
              '<div class="card-meta">' +
                '<span>' + (item.year || item.type || "") + '</span>' +
                '<span class="badge">' + (item.providerId || activeTab) + '</span>' +
              '</div>' +
            '</div>';
          card.addEventListener("click", function() {
            openItemSheet(item);
          });
          resultsGrid.appendChild(card);
        });
      }

      function openItemSheet(item) {
        activeItem = item;
        activeEpisode = 1;
        sheetTitle.innerText = item.title || item.name || "Title";
        episodesList.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;padding:8px;">Loading episodes...</div>';
        sheetOverlay.classList.add("active");

        fetch("/api/episodes?id=" + encodeURIComponent(item.id) + "&lane=" + encodeURIComponent(activeTab))
          .then(function(r) { return r.json(); })
          .then(function(data) {
            var episodes = data.episodes || [];
            if (episodes.length === 0) {
              episodes = [{ number: 1, title: "Play Title" }];
            }
            renderEpisodes(episodes);
            resolveAndSetupLaunchers(activeItem, activeEpisode);
          })
          .catch(function() {
            renderEpisodes([{ number: 1, title: "Play Title" }]);
            resolveAndSetupLaunchers(activeItem, activeEpisode);
          });
      }

      function renderEpisodes(episodes) {
        episodesList.innerHTML = "";
        episodes.forEach(function(ep) {
          var item = document.createElement("div");
          item.className = "episode-item" + (ep.number === activeEpisode ? " active" : "");
          item.innerHTML = '<span>Episode ' + ep.number + '</span><span style="color:var(--text-dim);font-size:0.8rem;">' + (ep.title || "") + '</span>';
          item.addEventListener("click", function() {
            document.querySelectorAll(".episode-item").forEach(function(el) { el.classList.remove("active"); });
            item.classList.add("active");
            activeEpisode = ep.number;
            resolveAndSetupLaunchers(activeItem, activeEpisode);
          });
          episodesList.appendChild(item);
        });
      }

      function resolveAndSetupLaunchers(item, ep) {
        fetch("/api/stream?titleId=" + encodeURIComponent(item.id) + "&episode=" + ep + "&lane=" + encodeURIComponent(activeTab))
          .then(function(r) { return r.json(); })
          .then(function(data) {
            var streamUrl = data.streamUrl || "";
            if (streamUrl) {
              var proxyStreamUrl = window.location.origin + "/proxy?url=" + encodeURIComponent(streamUrl);
              openVlcBtn.href = "vlc://" + streamUrl;
              openInfuseBtn.href = "infuse://x-callback-url/play?url=" + encodeURIComponent(streamUrl);
              if (errVlcBtn) errVlcBtn.href = "vlc://" + streamUrl;
              if (errInfuseBtn) errInfuseBtn.href = "infuse://x-callback-url/play?url=" + encodeURIComponent(streamUrl);

              if (retryProxyBtn) {
                retryProxyBtn.onclick = function() {
                  hidePlayerError();
                  player.src = proxyStreamUrl;
                  player.load();
                  player.play().catch(function() {
                    showPlayerError("Proxy Connection Stalled", "Could not route through relay server.");
                  });
                };
              }

              streamBrowserBtn.onclick = function() {
                hidePlayerError();
                videoWrap.style.display = "block";
                player.src = proxyStreamUrl;
                player.play().catch(function() {
                  showPlayerError("Playback Failed", "Tap below to retry via proxy or open directly in VLC:");
                });
              };

              castHostBtn.onclick = function() {
                fetch("/api/control", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "play", titleId: item.id, episode: ep })
                }).then(function() {
                  alert("Playback command sent to desktop terminal!");
                });
              };
            }
          });
      }

      function renderRemoteView() {
        searchBar.style.display = "none";
        emptyState.style.display = "none";
        loadingState.style.display = "none";
        resultsGrid.innerHTML =
          '<div class="remote-panel" style="grid-column: 1 / -1;">' +
            '<div style="font-weight:700;font-size:1.1rem;margin-bottom:8px;">Desktop Terminal Remote</div>' +
            '<div class="remote-dpad">' +
              '<button class="remote-btn" id="seekBackBtn">⏪ -10s</button>' +
              '<button class="remote-btn big" id="togglePlayBtn">⏯ Play</button>' +
              '<button class="remote-btn" id="seekFwdBtn">⏩ +10s</button>' +
              '<button class="remote-btn" id="volDownBtn">🔉 Vol -</button>' +
              '<button class="remote-btn" id="subToggleBtn">💬 Subs</button>' +
              '<button class="remote-btn" id="volUpBtn">🔊 Vol +</button>' +
            '</div>' +
          '</div>';

        function sendCmd(cmd) {
          fetch("/api/control", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: cmd })
          });
        }
        document.getElementById("seekBackBtn")?.addEventListener("click", function() { sendCmd("seek-backward"); });
        document.getElementById("togglePlayBtn")?.addEventListener("click", function() { sendCmd("toggle-pause"); });
        document.getElementById("seekFwdBtn")?.addEventListener("click", function() { sendCmd("seek-forward"); });
        document.getElementById("volDownBtn")?.addEventListener("click", function() { sendCmd("volume-down"); });
        document.getElementById("volUpBtn")?.addEventListener("click", function() { sendCmd("volume-up"); });
        document.getElementById("subToggleBtn")?.addEventListener("click", function() { sendCmd("toggle-subs"); });
      }

      function renderStatusView() {
        searchBar.style.display = "none";
        emptyState.style.display = "none";
        loadingState.style.display = "none";
        resultsGrid.innerHTML = '<div style="grid-column: 1 / -1; padding: 12px; color: var(--text-dim);">Loading provider status...</div>';

        fetch("/api/status")
          .then(function(r) { return r.json(); })
          .then(function(data) {
            var providers = data.providers || [];
            var rows = providers.map(function(p) {
              var badgeColor = p.status === "operational" ? "#48bb78" : p.status === "degraded" ? "#ed8936" : "#e53e3e";
              return '<tr>' +
                '<td style="font-weight:600;color:var(--text);">' + p.name + '</td>' +
                '<td>' + p.lane + '</td>' +
                '<td><span style="color:' + badgeColor + ';font-weight:600;">● ' + p.status + '</span></td>' +
                '<td>' + (p.latencyMs ? p.latencyMs + 'ms' : '—') + '</td>' +
              '</tr>';
            }).join("");

            resultsGrid.innerHTML =
              '<div style="grid-column: 1 / -1; overflow-x: auto;">' +
                '<table class="status-table">' +
                  '<thead><tr><th>Provider</th><th>Lane</th><th>Status</th><th>Latency</th></tr></thead>' +
                  '<tbody>' + rows + '</tbody>' +
                '</table>' +
              '</div>';
          })
          .catch(function() {
            resultsGrid.innerHTML = '<div style="grid-column: 1 / -1; padding: 12px; color: var(--accent);">Failed to load provider status.</div>';
          });
      }
    })();
  </script>
</body>
</html>
`;
}
