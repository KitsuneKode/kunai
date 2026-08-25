import { useDotMatrixAnimation, DotMatrixGrid } from "@/app-shell/dot-matrix-loader";
import {
  AUDIO_PREFERENCE_OPTIONS,
  RECOMMENDED_AUDIO_PREFERENCE,
  RECOMMENDED_SUBTITLE_PREFERENCE,
  SUBTITLE_PREFERENCE_OPTIONS,
} from "@/domain/media/media-preferences";
import type { CapabilitySnapshot } from "@/ui";
import { Box, Text, useInput } from "ink";
import React, { useState } from "react";

import packageJson from "../../package.json" with { type: "json" };
import {
  BLOOM_FRAMES,
  reducedMotionEnabled,
  STATIC_PETAL,
  useFrameTick,
} from "./primitives/SakuraPetal";
import { StepIndicator } from "./primitives/StepIndicator";
import { mountRootContent } from "./root-content-state";
import { ViewportResizeGate } from "./shell-primitives";
import { palette } from "./shell-theme";
import { useShellDimensions } from "./use-viewport-policy";

// ─── Types ────────────────────────────────────────────────────────────────────

type Slide =
  | "welcome"
  | "system"
  | "prefs-audio"
  | "prefs-subtitle"
  | "downloads"
  | "analytics"
  | "tips";

const SLIDE_ORDER: Slide[] = [
  "welcome",
  "system",
  "prefs-audio",
  "prefs-subtitle",
  "downloads",
  "analytics",
  "tips",
];

/** Step counter + indicator + padding above each slide body. */
const SETUP_CHROME_ROWS = 5;

/**
 * The consent screen must describe *this* machine. It used to print the literal
 * `"version": "0.3.0", "os": "linux", "arch": "x64"`, which made the one screen
 * that has to be exactly true a false statement on macOS and Windows.
 */
const KUNAI_VERSION: string = packageJson.version;

/**
 * Three outcomes, because "skipped" was doing two incompatible jobs.
 *
 * - `completed` — the user answered every step.
 * - `defaults`  — the user waved past some or all of it. The recommended
 *   configuration is written. Previously this wrote *nothing*: `skip()` built
 *   prefs and the caller discarded them, so skipping setup left the install
 *   unconfigured while telling the user it was set up.
 * - `aborted`   — esc. Nothing is written but the onboarding version, so a
 *   deliberate bail-out never rewrites settings the user already had.
 */
export type SetupFlowResult = "completed" | "defaults" | "aborted";

export interface SetupPrefs {
  audio: string;
  subtitle: string;
  downloadsEnabled: boolean;
  /**
   * Setup-time analytics choice before DO_NOT_TRACK / CI resolution.
   *
   * `unchanged` is not "off" — it means the consent slide was never reached, so
   * whatever the user already had must survive. Collapsing it into `disabled`
   * would silently opt out someone who had previously opted in and then reran
   * setup and pressed accept-all. Only a keystroke on the consent slide moves
   * this value, in either direction.
   */
  analyticsChoice: "enabled" | "disabled" | "unchanged";
}

// ─── Option data ──────────────────────────────────────────────────────────────

// One catalog, shared with `/settings` — see `domain/media/media-preferences.ts`.
const AUDIO_OPTS = AUDIO_PREFERENCE_OPTIONS;
const SUBTITLE_OPTS = SUBTITLE_PREFERENCE_OPTIONS;

/** Index of the recommended value, or 0 when it somehow left the catalog. */
function recommendedIndex(
  options: readonly { readonly value: string }[],
  recommended: string,
): number {
  const index = options.findIndex((option) => option.value === recommended);
  return index >= 0 ? index : 0;
}

const DOWNLOADS_ON_INDEX = 0;
const DOWNLOADS_OFF_INDEX = 1;
/** "Turn it on" leads the consent slide — see AnalyticsSlide for why. */
const ANALYTICS_ON_INDEX = 0;
const ANALYTICS_OFF_INDEX = 1;

// ─── Shared layout helpers ────────────────────────────────────────────────────

function SlideLayout({
  children,
  footer,
  width,
  rows,
}: {
  children: React.ReactNode;
  footer: React.ReactNode;
  width: number;
  rows: number;
}) {
  // Total height: children fills up, footer always at bottom.
  //
  // The reserve is 5, not 4: the footer block costs 4 rows (marginTop, border,
  // paddingTop, hint) and this container adds a paddingTop of its own. At a
  // reserve of 4 the box overflows by exactly one row and the hint line is
  // clipped at every terminal height — which on the analytics slide would
  // silently drop "[s] keep it off", the one escape hatch that must never be
  // lost from a consent screen.
  const contentHeight = Math.max(4, rows - 5);
  return (
    <Box
      flexDirection="column"
      width={width}
      height={rows}
      paddingX={Math.max(2, Math.floor((width - Math.min(width, 80)) / 2) + 3)}
      paddingTop={1}
    >
      <Box flexDirection="column" flexGrow={1} minHeight={contentHeight}>
        {children}
      </Box>
      <Box
        borderStyle="single"
        borderTop
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
        borderColor={palette.line}
        marginTop={1}
      >
        <Box paddingTop={1}>{footer}</Box>
      </Box>
    </Box>
  );
}

function FooterHint({ parts }: { parts: { key: string; label: string }[] }) {
  return (
    <Box gap={1} flexWrap="wrap">
      {parts.map(({ key, label }, i) => (
        <React.Fragment key={key}>
          {i > 0 ? <Text color={palette.dim}> · </Text> : null}
          <Text color={palette.accent}>[{key}]</Text>
          <Text color={palette.muted}> {label}</Text>
        </React.Fragment>
      ))}
    </Box>
  );
}

function SlideTitle({ text, sub }: { text: string; sub?: string }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={palette.text} bold>
        {text}
      </Text>
      {sub ? (
        <Text color={palette.muted} dimColor>
          {sub}
        </Text>
      ) : null}
    </Box>
  );
}

// ─── Slides ───────────────────────────────────────────────────────────────────

function WelcomeSlide({ width, rows }: { width: number; rows: number }) {
  const frame = useDotMatrixAnimation("echo-ring", 80, true);
  const isNarrow = width < 64;

  return (
    <SlideLayout
      width={width}
      rows={rows}
      footer={
        <FooterHint
          parts={[
            { key: "Enter", label: "start setup" },
            { key: "S", label: "use recommended" },
            { key: "esc", label: "skip setup" },
          ]}
        />
      }
    >
      <Box flexDirection="column" flexGrow={1} justifyContent="center">
        {!isNarrow ? (
          <Box marginBottom={1}>
            <DotMatrixGrid frame={frame} onColor={palette.accent} offColor={palette.dim} />
          </Box>
        ) : null}

        <Box flexDirection="column" marginBottom={2}>
          <Text color={palette.text} bold>
            🦊 Kunai
          </Text>
          <Text color={palette.text}>Terminal-first streaming.</Text>
          <Text color={palette.muted} dimColor>
            Direct streams. No browser. Your terminal is the remote.
          </Text>
        </Box>

        <Box flexDirection="column" gap={0}>
          <Text color={palette.muted}>Take 30 seconds to set up audio, subtitles, and</Text>
          <Text color={palette.muted}>downloads — then jump straight into watching.</Text>
        </Box>
      </Box>
    </SlideLayout>
  );
}

type DepStatus = "ok" | "missing" | "optional-missing";

interface DepRow {
  name: string;
  status: DepStatus;
  detail: string;
  install?: string;
  fatal?: boolean;
}

function depIcon(status: DepStatus): string {
  if (status === "ok") return "✓";
  if (status === "missing") return "✗";
  return "○";
}

function depColor(status: DepStatus): string {
  if (status === "ok") return palette.ok;
  if (status === "missing") return palette.danger;
  return palette.accentDeep;
}

function SystemSlide({
  width,
  rows,
  snapshot,
}: {
  width: number;
  rows: number;
  snapshot: CapabilitySnapshot;
}) {
  const deps: DepRow[] = [
    {
      name: "mpv",
      status: snapshot.mpv ? "ok" : "missing",
      detail: snapshot.mpv
        ? "Playback engine ready"
        : "Required for playback — continue setup and install later",
      install:
        "brew install mpv  ·  pacman -S mpv  ·  apt install mpv  ·  winget install --id mpv-player.mpv-CI.MSVC -e",
      fatal: true,
    },
    {
      name: "yt-dlp",
      status: snapshot.ytDlp ? "ok" : "optional-missing",
      detail: snapshot.ytDlp
        ? "YouTube playback + download engine ready"
        : "Required for YouTube playback and offline downloads",
      install: "brew install yt-dlp  ·  pip install yt-dlp",
    },
    {
      name: "ffprobe",
      status: snapshot.ffprobe ? "ok" : "optional-missing",
      detail: snapshot.ffprobe
        ? "Download validation ready"
        : "Optional — validates downloaded files",
      install: "Install ffprobe from your platform media-tools package when needed",
    },
    {
      // Three states, not two. Plain curl exists nearly everywhere, so folding
      // it in with an impersonate build showed a green tick on a machine whose
      // anime search would come back empty — the failure this row exists to
      // warn about. `snapshot.curl` is an object now: never test it for
      // truthiness, which is always true and silently reports "ok".
      name: "curl-impersonate",
      status: snapshot.curl.impersonates ? "ok" : "optional-missing",
      detail: snapshot.curl.impersonates
        ? `Anime search ready — matching ${snapshot.curl.profile}`
        : snapshot.curl.present
          ? "Only plain curl — Cloudflare may still block AniDB and Miruro"
          : "No curl at all — AniDB, the default anime provider, needs one",
      install:
        "brew install lexiforest/tap/curl-impersonate  ·  pacman -S curl-impersonate  ·  else: github.com/lexiforest/curl-impersonate/releases",
    },
    {
      name: "posters",
      status: snapshot.image.renderer !== "none" ? "ok" : "optional-missing",
      detail:
        snapshot.image.renderer !== "none"
          ? `Active via ${snapshot.image.renderer} (${snapshot.image.terminal})`
          : "Optional — this terminal reports no image support",
      // Nothing to install any more: every renderer consumes one natively
      // prepared image and half-block is the universal floor.
      install: "No install needed — posters render in process",
    },
  ];

  const hasFatal = deps.some((d) => d.fatal && d.status === "missing");

  return (
    <SlideLayout
      width={width}
      rows={rows}
      footer={
        hasFatal ? (
          <FooterHint
            parts={[
              { key: "Enter", label: "continue anyway" },
              { key: "S", label: "use recommended" },
            ]}
          />
        ) : (
          <FooterHint
            parts={[
              { key: "Enter", label: "next" },
              { key: "←/b", label: "back" },
              { key: "S", label: "use recommended" },
            ]}
          />
        )
      }
    >
      <SlideTitle
        text="System check"
        sub={
          hasFatal
            ? "mpv is required for playback — install it when ready, or continue setup now."
            : "Everything you need is accounted for."
        }
      />

      <Box flexDirection="column" gap={0}>
        {deps.map((dep) => (
          <Box key={dep.name} flexDirection="column" marginBottom={1}>
            <Box>
              <Text color={depColor(dep.status)} bold>
                {depIcon(dep.status)}{" "}
              </Text>
              <Text
                color={
                  dep.status === "ok"
                    ? palette.text
                    : dep.fatal
                      ? palette.danger
                      : palette.accentDeep
                }
                bold={dep.status !== "ok"}
              >
                {dep.name}
              </Text>
              <Text color={palette.muted}>{"  "}</Text>
              <Text color={palette.muted}>{dep.detail}</Text>
            </Box>
            {dep.status !== "ok" && dep.install ? (
              <Box paddingLeft={2}>
                <Text color={palette.dim} dimColor>
                  {dep.install}
                </Text>
              </Box>
            ) : null}
          </Box>
        ))}
      </Box>
    </SlideLayout>
  );
}

function PickerSlide({
  width,
  rows,
  title,
  sub,
  options,
  selectedIndex,
  onMove,
}: {
  width: number;
  rows: number;
  title: string;
  sub: string;
  options: readonly { value: string; label: string; detail: string }[];
  selectedIndex: number;
  onMove: (delta: number) => void;
}) {
  // useInput is hoisted in SetupShell — we just show the UI
  void onMove; // suppress unused lint; movement handled in parent

  return (
    <SlideLayout
      width={width}
      rows={rows}
      footer={
        <FooterHint
          parts={[
            { key: "Enter", label: "confirm & next" },
            { key: "↑↓", label: "choose" },
            { key: "←/b", label: "back" },
            { key: "s", label: "use recommended" },
          ]}
        />
      }
    >
      <SlideTitle text={title} sub={sub} />
      <Box flexDirection="column">
        {options.map((opt, i) => {
          const selected = i === selectedIndex;
          return (
            <Box
              key={opt.value}
              marginBottom={0}
              backgroundColor={selected ? palette.accentFill : undefined}
            >
              <Text color={selected ? palette.accent : palette.dim}>{selected ? "▌ " : "  "}</Text>
              <Box flexDirection="column">
                <Text color={palette.text} bold={selected}>
                  {opt.label}
                </Text>
                <Text color={selected ? palette.muted : palette.dim} dimColor={!selected}>
                  {"  "}
                  {opt.detail}
                </Text>
              </Box>
            </Box>
          );
        })}
      </Box>
    </SlideLayout>
  );
}

function DownloadsSlide({
  width,
  rows,
  ytDlpReady,
  selectedIndex,
}: {
  width: number;
  rows: number;
  ytDlpReady: boolean;
  selectedIndex: number;
}) {
  const opts = [
    {
      label: "Enable downloads",
      detail: ytDlpReady
        ? "Queue titles from search or playback · manage with /downloads"
        : "Install yt-dlp to activate queue · preference saved for later",
    },
    {
      label: "Keep disabled",
      detail: "Stream-only mode · you can enable downloads anytime in /settings",
    },
  ];

  return (
    <SlideLayout
      width={width}
      rows={rows}
      footer={
        <FooterHint
          parts={[
            { key: "Enter", label: "confirm & next" },
            { key: "↑↓", label: "choose" },
            { key: "←/b", label: "back" },
            { key: "s", label: "use recommended" },
          ]}
        />
      }
    >
      <SlideTitle
        text="Offline downloads"
        sub={
          ytDlpReady
            ? "yt-dlp detected — downloads are ready to go."
            : "yt-dlp not found — you can install it later to enable downloads."
        }
      />

      <Box flexDirection="column">
        {opts.map((opt, i) => {
          const selected = i === selectedIndex;
          return (
            <Box
              key={opt.label}
              marginBottom={0}
              backgroundColor={selected ? palette.accentFill : undefined}
            >
              <Text color={selected ? palette.accent : palette.dim}>{selected ? "▌ " : "  "}</Text>
              <Box flexDirection="column">
                <Text color={palette.text} bold={selected}>
                  {opt.label}
                </Text>
                <Text color={selected ? palette.muted : palette.dim} dimColor={!selected}>
                  {"  "}
                  {opt.detail}
                </Text>
              </Box>
            </Box>
          );
        })}
      </Box>

      {!ytDlpReady ? (
        <Box marginTop={1}>
          <Text color={palette.dim} dimColor>
            Install: brew install yt-dlp · pip install yt-dlp
          </Text>
        </Box>
      ) : null}
    </SlideLayout>
  );
}

/**
 * Slow, deliberate petal drift. Loader cadence (150ms) would say this screen
 * is loading something; it is not. The user is reading a consent decision.
 */
const CONSENT_PETAL_INTERVAL_MS = 900;

/** Exported only so the consent copy can be asserted in a unit test. */
export function AnalyticsSlide({
  width,
  rows,
  selectedIndex,
}: {
  width: number;
  rows: number;
  selectedIndex: number;
}) {
  // Motion lives in the frame ornaments only — never under the text being read.
  const tick = useFrameTick(true, CONSENT_PETAL_INTERVAL_MS);
  const still = reducedMotionEnabled();
  const bloom = still ? STATIC_PETAL : (BLOOM_FRAMES[tick % BLOOM_FRAMES.length] ?? STATIC_PETAL);
  const sidePetal = still || tick % 2 === 0 ? "✿" : " ";

  // Recommended first, and index 0 is now "on". `s` on this slide still selects
  // OFF and no accept-all path reaches it — see ANALYTICS_ON_INDEX and the
  // input handler. A recommendation the user pressed a key on is consent; a
  // default they never saw is not.
  const opts = [
    {
      label: "Turn it on",
      detail: "One ping a day. Counts unique installs, not people.",
    },
    {
      label: "Keep it off",
      detail: "No network calls. No install id stored on disk.",
    },
  ];

  return (
    <SlideLayout
      width={width}
      rows={rows}
      footer={
        <FooterHint
          parts={[
            { key: "Enter", label: "confirm" },
            { key: "←/b", label: "back" },
            { key: "s", label: "keep it off" },
          ]}
        />
      }
    >
      <Box>
        <Text color={palette.accent} bold>
          {bloom}
        </Text>
        <Text color={palette.text} bold>
          {"  Anonymous usage ping  "}
        </Text>
        <Text color={palette.dim}>{sidePetal}</Text>
      </Box>

      <SlideTitle text="" sub="Recommended. Nothing is sent until you confirm here." />

      <Box flexDirection="column">
        {opts.map((opt, i) => {
          const selected = i === selectedIndex;
          return (
            <Box
              key={opt.label}
              marginBottom={0}
              backgroundColor={selected ? palette.accentFill : undefined}
            >
              <Text color={selected ? palette.accent : palette.dim}>{selected ? "▌ " : "  "}</Text>
              <Box flexDirection="column">
                <Text color={palette.text} bold={selected}>
                  {opt.label}
                  {i === ANALYTICS_ON_INDEX ? "   ← recommended" : ""}
                </Text>
                <Text color={selected ? palette.muted : palette.dim} dimColor={!selected}>
                  {"  "}
                  {opt.detail}
                </Text>
              </Box>
            </Box>
          );
        })}
      </Box>

      <Box flexDirection="column" marginTop={1} paddingLeft={2}>
        <Text color={palette.muted}>Exactly what is sent, from this machine</Text>
        <Text color={palette.text}>
          {`{ "installId": "<sha256 of a local id>", "version": "${KUNAI_VERSION}",`}
        </Text>
        <Text color={palette.text}>
          {`  "os": "${process.platform}", "arch": "${process.arch}", "ts": 0 }`}
        </Text>
        <Text color={palette.dim} dimColor>
          Never: titles · queries · providers · URLs · paths · your IP
        </Text>
        <Text color={palette.dim} dimColor>
          The raw id never leaves this machine. Off in /settings deletes it.
        </Text>
      </Box>
    </SlideLayout>
  );
}

const TIPS = [
  {
    key: "/",
    title: "Command palette",
    body: "Press / from anywhere — commands are grouped by current screen context.",
  },
  {
    key: "search",
    title: "Search anything",
    body: 'Type a title at the prompt, or launch directly: kunai -S "Attack on Titan".',
  },
  {
    key: "/discover",
    title: "Discover & surprise",
    body: "/discover for recommendations · /random for a surprise · /calendar for airing today.",
  },
  {
    key: "/recover",
    title: "When streams stall",
    body: "/recover refreshes the current stream · /fallback tries another provider.",
  },
  {
    key: "/setup",
    title: "Rerun this setup",
    body: "Run /setup from the command palette to revisit preferences at any time.",
  },
] as const;

function TipsSlide({ width, rows }: { width: number; rows: number }) {
  return (
    <SlideLayout
      width={width}
      rows={rows}
      footer={<FooterHint parts={[{ key: "Enter", label: "start watching" }]} />}
    >
      <SlideTitle text="You're all set" sub="Quick things to know:" />

      <Box flexDirection="column" gap={0}>
        {TIPS.map((tip) => (
          <Box key={tip.key} flexDirection="column" marginBottom={1}>
            <Box>
              <Text color={palette.text} bold>
                {tip.title}
              </Text>
            </Box>
            <Box paddingLeft={2}>
              <Text color={palette.muted}>{tip.body}</Text>
            </Box>
          </Box>
        ))}
      </Box>
    </SlideLayout>
  );
}

function WizStepCounter({ current, total }: { readonly current: number; readonly total: number }) {
  return (
    <Text>
      <Text color={palette.muted}>{"❮ step "}</Text>
      <Text color={palette.accent} bold>
        {String(current + 1)}
      </Text>
      <Text color={palette.muted}>{` of ${total} ❯`}</Text>
    </Text>
  );
}

// ─── Main SetupShell component ────────────────────────────────────────────────

export function SetupShell({
  snapshot,
  finish,
}: {
  snapshot: CapabilitySnapshot;
  finish: (result: SetupFlowResult, prefs: SetupPrefs) => void;
}) {
  const { cols, rows } = useShellDimensions();

  const [slideIdx, setSlideIdx] = useState(0);
  // Every picker opens on its recommended option, so Enter-through produces the
  // configuration the defaults table promises rather than whatever sits first.
  const [audioIdx, setAudioIdx] = useState(() =>
    recommendedIndex(AUDIO_OPTS, RECOMMENDED_AUDIO_PREFERENCE),
  );
  const [subtitleIdx, setSubtitleIdx] = useState(() =>
    recommendedIndex(SUBTITLE_OPTS, RECOMMENDED_SUBTITLE_PREFERENCE),
  );
  // Downloads follow what is installed. Defaulting to "Enable" on a machine
  // with no yt-dlp pre-selected the one option that cannot work.
  const [downloadsIdx, setDownloadsIdx] = useState(() =>
    snapshot.ytDlp ? DOWNLOADS_ON_INDEX : DOWNLOADS_OFF_INDEX,
  );
  // Index 0 is "turn it on" — the recommendation. It is only ever committed by
  // a keystroke on this slide: `s` selects off, and accept-all stops here.
  const [analyticsIdx, setAnalyticsIdx] = useState(ANALYTICS_ON_INDEX);
  /** True once the user has actually seen the consent slide. */
  const [analyticsSeen, setAnalyticsSeen] = useState(false);

  const slide = SLIDE_ORDER[slideIdx] as Slide;
  const isPickerSlide =
    slide === "prefs-audio" ||
    slide === "prefs-subtitle" ||
    slide === "downloads" ||
    slide === "analytics";

  /**
   * `consented` is passed explicitly rather than read from state because the
   * accept-all path has to build prefs for slides the user never reached, and
   * analytics is the one value a never-reached slide must not be able to set.
   */
  function buildPrefs(consented: boolean): SetupPrefs {
    return {
      audio: AUDIO_OPTS[audioIdx]?.value ?? RECOMMENDED_AUDIO_PREFERENCE,
      subtitle: SUBTITLE_OPTS[subtitleIdx]?.value ?? RECOMMENDED_SUBTITLE_PREFERENCE,
      downloadsEnabled: downloadsIdx === DOWNLOADS_ON_INDEX,
      analyticsChoice: !consented
        ? "unchanged"
        : analyticsIdx === ANALYTICS_ON_INDEX
          ? "enabled"
          : "disabled",
    };
  }

  function advance() {
    if (slideIdx < SLIDE_ORDER.length - 1) {
      const next = SLIDE_ORDER[slideIdx + 1];
      if (next === "analytics") setAnalyticsSeen(true);
      setSlideIdx((current) => current + 1);
    } else {
      finish("completed", buildPrefs(analyticsSeen));
    }
  }

  function back() {
    if (slideIdx > 0) setSlideIdx((i) => i - 1);
  }

  /**
   * Accept every remaining step's recommendation and finish.
   *
   * Analytics is deliberately excluded when the consent slide has not been
   * reached: a blanket "yes to everything" is not consent to send data. This is
   * the outward-facing rule — no skip path may enable analytics, start an OAuth
   * handoff, or touch presence IPC.
   */
  function acceptRemainingDefaults() {
    finish("defaults", buildPrefs(analyticsSeen));
  }

  /** esc — leave settings exactly as they were. */
  function abort() {
    finish("aborted", buildPrefs(false));
  }

  useInput((input, key) => {
    if (key.escape) {
      abort();
      return;
    }

    // `S` — accept every remaining recommendation and finish. On the consent
    // slide it advances instead of passing through, so analytics is never
    // enabled by a keystroke aimed at everything else.
    if (input === "S") {
      if (slide === "analytics") {
        setAnalyticsIdx(ANALYTICS_OFF_INDEX);
        advance();
        return;
      }
      acceptRemainingDefaults();
      return;
    }

    // `s` — take this step's recommendation and move on. It no longer ends the
    // wizard: waving past one question you do not care about should not cost
    // you the rest of setup.
    if (input === "s") {
      if (slide === "analytics") setAnalyticsIdx(ANALYTICS_OFF_INDEX);
      advance();
      return;
    }

    if (input === "q" || input === "Q") {
      abort();
      return;
    }

    if (key.return) {
      advance();
      return;
    }

    if (key.leftArrow || input === "b" || input === "B") {
      if (slide !== "welcome") back();
      return;
    }

    if (isPickerSlide) {
      if (key.upArrow) {
        if (slide === "prefs-audio") {
          setAudioIdx((i) => Math.max(0, i - 1));
        } else if (slide === "prefs-subtitle") {
          setSubtitleIdx((i) => Math.max(0, i - 1));
        } else if (slide === "downloads") {
          setDownloadsIdx((i) => Math.max(0, i - 1));
        } else if (slide === "analytics") {
          setAnalyticsIdx((i) => Math.max(0, i - 1));
        }
        return;
      }
      if (key.downArrow) {
        if (slide === "prefs-audio") {
          setAudioIdx((i) => Math.min(AUDIO_OPTS.length - 1, i + 1));
        } else if (slide === "prefs-subtitle") {
          setSubtitleIdx((i) => Math.min(SUBTITLE_OPTS.length - 1, i + 1));
        } else if (slide === "downloads") {
          setDownloadsIdx((i) => Math.min(1, i + 1));
        } else if (slide === "analytics") {
          setAnalyticsIdx((i) => Math.min(1, i + 1));
        }
        return;
      }
    }
  });

  return (
    <ViewportResizeGate kind="picker" message="Resize terminal to run setup">
      <Box flexDirection="column" width={cols} height={rows}>
        {/* Slide progress indicator */}
        <Box
          paddingX={Math.max(2, Math.floor((cols - Math.min(cols, 80)) / 2) + 3)}
          paddingTop={1}
          flexDirection="column"
          gap={1}
        >
          <WizStepCounter current={slideIdx} total={SLIDE_ORDER.length} />
          <StepIndicator total={SLIDE_ORDER.length} current={slideIdx} />
        </Box>

        {slide === "welcome" ? (
          <WelcomeSlide width={cols} rows={Math.max(8, rows - SETUP_CHROME_ROWS)} />
        ) : null}
        {slide === "system" ? (
          <SystemSlide
            width={cols}
            rows={Math.max(8, rows - SETUP_CHROME_ROWS)}
            snapshot={snapshot}
          />
        ) : null}
        {slide === "prefs-audio" ? (
          <PickerSlide
            width={cols}
            rows={Math.max(8, rows - SETUP_CHROME_ROWS)}
            title="Audio preference"
            sub="Which audio track should Kunai prefer when multiple options exist?"
            options={AUDIO_OPTS}
            selectedIndex={audioIdx}
            onMove={() => {}}
          />
        ) : null}
        {slide === "prefs-subtitle" ? (
          <PickerSlide
            width={cols}
            rows={Math.max(8, rows - SETUP_CHROME_ROWS)}
            title="Subtitle preference"
            sub="Default subtitle language — you can always change per-episode."
            options={SUBTITLE_OPTS}
            selectedIndex={subtitleIdx}
            onMove={() => {}}
          />
        ) : null}
        {slide === "downloads" ? (
          <DownloadsSlide
            width={cols}
            rows={Math.max(8, rows - SETUP_CHROME_ROWS)}
            ytDlpReady={snapshot.ytDlp}
            selectedIndex={downloadsIdx}
          />
        ) : null}
        {slide === "analytics" ? (
          <AnalyticsSlide
            width={cols}
            rows={Math.max(8, rows - SETUP_CHROME_ROWS)}
            selectedIndex={analyticsIdx}
          />
        ) : null}
        {slide === "tips" ? (
          <TipsSlide width={cols} rows={Math.max(8, rows - SETUP_CHROME_ROWS)} />
        ) : null}
      </Box>
    </ViewportResizeGate>
  );
}

// ─── F1 capture harness ───────────────────────────────────────────────────────

/** Ink F1 capture — welcome slide only (no mountRootContent). */
export function SetupHarnessWelcomeSlide({
  width = 100,
  rows = 40,
}: {
  width?: number;
  rows?: number;
}) {
  return <WelcomeSlide width={width} rows={rows} />;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function runSetupFlow(snapshot: CapabilitySnapshot): {
  result: Promise<{ outcome: SetupFlowResult; prefs: SetupPrefs }>;
} {
  const mounted = mountRootContent<{ outcome: SetupFlowResult; prefs: SetupPrefs }>({
    kind: "picker",
    renderContent: (finish) => (
      <SetupShell snapshot={snapshot} finish={(outcome, prefs) => finish({ outcome, prefs })} />
    ),
    // Ink teardown settles here. That is not a user decision, so it must not
    // write settings — `aborted` leaves the existing config alone.
    fallbackValue: {
      outcome: "aborted",
      prefs: {
        audio: RECOMMENDED_AUDIO_PREFERENCE,
        subtitle: RECOMMENDED_SUBTITLE_PREFERENCE,
        downloadsEnabled: false,
        analyticsChoice: "unchanged",
      },
    },
  });

  return { result: mounted.result };
}
