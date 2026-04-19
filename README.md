# KitsuneSnipe 🦊🎯

An automated TypeScript/Bun reconnaissance and CLI tool designed to bypass aggressive frontend anti-debugging traps, extract raw `.m3u8` video streams, intercept hidden APIs, and pipe streams directly into `mpv` for seamless playback.

Currently maps APIs for:

- **cineby.sc** - Movie and TV show streaming
- **vidking.net** - Alternative streaming source

## ✨ Features

- **DOM Trap Neutralization:** Injects scripts to block `window.close()` and intercepts `beforeunload` events to neutralize `about:blank` redirects.
- **Async Network Interception:** Monitors the main page and spawned popups to snatch `.m3u8` manifests and `.vtt`/`.srt` subtitles.
- **Header Extraction:** Automatically steals the browser's dynamic `Referer`, `Origin`, and `User-Agent` headers to bypass server-side HTTP 403 (Forbidden) Hotlink protection.
- **API Snooping & Logging:** Logs hidden backend `fetch`/`xhr` requests to `logs.txt`, making it easy to map the underlying API for Go/Rust/TypeScript HTTP clients.
- **Direct MPV Piped Playback:** Kills the Chromium instance the millisecond the stream is found to free up RAM, piping playback and headers directly into `mpv`.
- **Multi-Provider Support:** Easily switch between different streaming providers with simple command-line flags.

## 🚀 Prerequisites

Before you begin, ensure you have the following installed:

1. **[Bun](https://bun.sh/)**: The fast all-in-one JavaScript runtime.
2. **[mpv](https://mpv.io/)**: A free, open-source, and highly versatile media player.
   - *Ubuntu/Debian:* `sudo apt install mpv`
   - *Arch Linux:* `sudo pacman -S mpv`
   - *macOS:* `brew install mpv`

## 📦 Installation

### Option 1: Local Development (Recommended for contributors/recon)

1. Clone the repository:

   ```bash
   git clone [https://github.com/kitsunekode/kitsunesnipe.git](https://github.com/kitsunekode/kitsunesnipe.git)
   cd kitsunesnipe
   ```

2. Install dependencies:

   ```bash
   bun install
   ```

3. Install Playwright browser binaries (Chromium only):

   ```bash
   bunx playwright install chromium
   ```

### Option 2: Global Installation (Via Run CLI)

Once the `@kitsunekode/run-cli` package is published, you can use it globally to execute the scrapers from anywhere:

```bash
# Install globally (optional - you can also use bunx without installing)
bun add -g @kitsunekode/run-cli

# Or use directly with bunx (no installation needed)
bunx run
```

## 💻 Usage

### Local Execution (Direct File Run)

If you are testing specific providers during development, run the files directly:

To run the scraper for **cineby.sc**:

```bash
bun run cineby.ts
```

To run the scraper for **vidking.net**:

```bash
bun run vidking.ts
```

### Global CLI Wrapper Usage

Using the custom `@kitsunekode/run-cli` wrapper:

To scrape from **cineby.sc** (default provider):

```bash
run
# or
bunx run
```

To scrape from **vidking.net**:

```bash
run -p vidking
# or
bunx run -p vidking
```

To see all available options:

```bash
run --help
```

## ⚠️ Disclaimer

This tool is built strictly for educational and research purposes. It is designed to demonstrate network interception, API reverse-engineering, and the bypassing of frontend obfuscation techniques. The author does not host, provide, or condone the piracy of copyrighted media.

## 🚀 Future Enhancements (Roadmap)

While KitsuneSnipe acts as our heavy recon tool, future lightweight CLI implementations will include:

1. **IMDb/TMDB Integration:**
   - Search movies/series by title using the TMDB API.
   - Automatically map TMDB/IMDb IDs to provider-specific IDs.
   - Example workflow: `run --search "The Boys" --provider vidking`

2. **Smart ID Resolution:**
   - Convert TMDB/IMDb IDs to provider-specific paths dynamically.
   - Cineby.sc pattern: `/tv/{tmdb_id}/{season}/{episode}?play=true`
   - Vidking.net pattern: `/embed/movie/{tmdb_id}` or `/embed/tv/{tmdb_id}/{season}/{episode}`

3. **Batch Processing:**
   - Process multiple movies/series from a list to test API stability.
   - Generate reports of working/non-working streams.
