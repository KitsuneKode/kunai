# Kitty Visual and Live Verification

## 1. Safety and Multi-Monitor Hyprland Desktop Driving

When executing live Kitty visual or playback tests on a multi-monitor graphical workstation:

- **Sole Coordinator Contract**: Exactly one agent or process may drive the desktop at any time. Never run concurrent desktop drivers.
- **Reserved Surface**:
  - The user's active monitor is `DP-3` (focus must remain untouched).
  - All owned test windows (Kitty terminal and mpv player) must be placed on laptop display **`eDP-1`**, workspace **`9`**.
- **Hyprland Lua Rule Registration**:
  Hyprland rules must be registered dynamically via `hyprctl eval` (or the interactive `hyprctl repl`), retained in Lua's global `_G` table, and disabled during cleanup.
  Give the owned mpv wrapper `--wayland-app-id=kunai-verification-player`; never
  match every `mpv` window. Use unique rule names, verify no collision, and apply
  `no_initial_focus=true` to owned windows.
  ```lua
  _G.kunai_ws_rule = hl.workspace_rule({ workspace = "9", monitor = "eDP-1" })
  _G.kunai_window_rule = hl.window_rule({ name = "kunai-kitty-test", match = { class = "^(kunai-verification)$" }, workspace = "9 silent", no_initial_focus = true })
  _G.kunai_mpv_rule = hl.window_rule({ name = "kunai-mpv-test", match = { class = "^(kunai-verification-player)$" }, workspace = "9 silent", no_initial_focus = true })
  ```
- **Placement Verification Before Input**:
  Before injecting any keystroke or mouse event:
  1. Query active window: `hyprctl activewindow -j` → Verify focus remains on `DP-3`.
  2. Query clients: `hyprctl clients -j` → Verify the owned `kunai-verification` window exists on workspace `9`, monitor `eDP-1` (resolve its current ID from `hyprctl monitors -j`).
  3. If placement fails or focus is stolen, immediately stop, clean up, and mark the run **unverified** rather than typing into an unintended window.
- **Rule Cleanup in `finally`**:
  ```lua
  if _G.kunai_ws_rule then pcall(function() _G.kunai_ws_rule:set_enabled(false) end); _G.kunai_ws_rule = nil end
  if _G.kunai_window_rule then pcall(function() _G.kunai_window_rule:set_enabled(false) end); _G.kunai_window_rule = nil end
  if _G.kunai_mpv_rule then pcall(function() _G.kunai_mpv_rule:set_enabled(false) end); _G.kunai_mpv_rule = nil end
  ```

---

## 2. Launch and Profile Isolation

From `apps/cli`, with Kitty and Bun installed:

```sh
bun run agent:kitty --evidence /path/to/durable-evidence-dir
```

Every run must specify a **NEW, durable directory outside `/tmp`** (e.g. `/home/kitsunekode/.t3/scratch/kunai-agy-verification-...`).

- The launcher generates an isolated profile (`storageRootEnv`), private socket, and mock mpv or real mpv wrapper.
- Font family defaults to `DankMono Nerd Font Mono`. Pass `--font "<family>"` to override.
- Never attach to an existing terminal session or the user's live profile.

### Custom Journey via JSON Recipe

```json
{
  "argv": ["-i", "27205", "-t", "movie"],
  "steps": [
    { "type": "decoded" },
    { "type": "capture", "value": "after-sustained-playback" },
    { "type": "key", "value": "q" }
  ]
}
```

Run with:

```sh
bun run agent:kitty --live --provider vidlink --scenario /path/to/recipe.json --evidence /path/to/evidence --timeout 60 --observe 45
```

---

## 3. Decoded Video Inspection vs Clock Progress

- **The Dual-Witness Standard**:
  - `time-pos` advancing and positive video dimensions prove the player decoded media, but do not prove visible frames (e.g. a static poster or blank black screen).
  - The harness captures a video frame to `decoded-frame.png` via mpv IPC:
    ```json
    ["screenshot-to-file", "decoded-frame.png", "video"]
    ```
  - **Human/Agent Frame Inspection**: Inspect `decoded-frame.png` to confirm actual motion picture imagery rather than an error banner or black frame.
- **Observation Deadlines**:
  - Default observation requires sustained playback: `--observe 45` requires at least 45 seconds of accumulated advancement; stalled intervals earn zero credit.
  - Seeks contribute at most one sampling interval, not their full jump distance.
  - Playback witnesses sample at one-second windows: mpv can repeat clock values
    across faster reads, so a 100 ms clamp can substantially undercount batched
    progress. The 45-second accumulated and elapsed gates remain unchanged.
    Capture raw samples before attributing a failed observation to the provider.

---

## 4. Pointer and Mouse Verification Boundaries

- `click` steps in scenario recipes inject SGR mouse protocol escape sequences into the terminal PTY. They prove terminal mouse routing and hit-testing in Ink, but **do not prove native OS mouse delivery**.
- For native desktop clicks, use `ydotool` against the owned window coordinates only after verifying client geometry. Never send blind clicks.

---

## 5. Cleanup Verification

On session completion or abort:

1. Kitty remote closes window (`close-window`).
2. mpv IPC issues `quit`.
3. Signal termination confirms all child PIDs exited.
4. `cleanup.json` records:
   ```json
   {
     "privateStateClean": true,
     "terminalExited": true,
     "childrenExited": true,
     "profileRetained": false
   }
   ```
5. Confirm no analytics identity was minted (`installId` empty).
