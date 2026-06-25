import { useDotMatrixAnimation, DotMatrixGrid } from "@/app-shell/dot-matrix-loader";
import type { CapabilitySnapshot } from "@/ui";
import { Box, Text, useInput } from "ink";
import React, { useState } from "react";

import { StepIndicator } from "./primitives/StepIndicator";
import { mountRootContent } from "./root-content-state";
import { ViewportResizeGate } from "./shell-primitives";
import { palette } from "./shell-theme";
import { useShellDimensions } from "./use-viewport-policy";

// ─── Types ────────────────────────────────────────────────────────────────────

type Slide = "welcome" | "system" | "prefs-audio" | "prefs-subtitle" | "downloads" | "tips";

const SLIDE_ORDER: Slide[] = [
  "welcome",
  "system",
  "prefs-audio",
  "prefs-subtitle",
  "downloads",
  "tips",
];

export type SetupFlowResult = "completed" | "skipped";

export interface SetupPrefs {
  audio: string;
  subtitle: string;
  downloadsEnabled: boolean;
}

// ─── Option data ──────────────────────────────────────────────────────────────

const AUDIO_OPTS = [
  {
    value: "original",
    label: "Original",
    detail: "Use the native language from the provider",
  },
  { value: "en", label: "English dub", detail: "Prefer English audio when available" },
  { value: "ja", label: "Japanese", detail: "Prefer Japanese audio (anime-first)" },
  { value: "dub", label: "Any dub", detail: "Prefer any dubbed track over original" },
] as const;

const SUBTITLE_OPTS = [
  { value: "en", label: "English", detail: "English subtitles by default" },
  { value: "none", label: "None", detail: "No subtitles unless you enable per-episode" },
  {
    value: "interactive",
    label: "Ask me each time",
    detail: "Pick subtitles interactively per episode",
  },
  { value: "ja", label: "Japanese", detail: "Japanese subtitles" },
  { value: "es", label: "Spanish", detail: "Spanish subtitles" },
  { value: "fr", label: "French", detail: "French subtitles" },
] as const;

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
  // Total height: children fills up, footer always at bottom
  const contentHeight = Math.max(4, rows - 4);
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
            { key: "s", label: "skip to search" },
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
        : "Required for playback — install to continue",
      install: "brew install mpv  ·  pacman -S mpv  ·  apt install mpv",
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
      name: snapshot.image.renderer !== "none" ? "posters" : "posters (chafa/kitty)",
      status:
        snapshot.image.renderer !== "none" ? "ok" : snapshot.chafa ? "ok" : "optional-missing",
      detail:
        snapshot.image.renderer !== "none"
          ? `Active via ${snapshot.image.renderer} (${snapshot.image.terminal})`
          : snapshot.chafa
            ? "chafa available, terminal may not support graphics"
            : "Optional — poster art in browse/picker",
      install: "brew install chafa  ·  pacman -S chafa  ·  apt install chafa",
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
              { key: "s", label: "skip setup" },
            ]}
          />
        ) : (
          <FooterHint
            parts={[
              { key: "Enter", label: "next" },
              { key: "←/b", label: "back" },
              { key: "s", label: "skip" },
            ]}
          />
        )
      }
    >
      <SlideTitle
        text="System check"
        sub={
          hasFatal
            ? "mpv is required — install it then relaunch. Or continue and set it up later."
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
            { key: "s", label: "skip" },
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
            { key: "s", label: "skip" },
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

function SetupShell({
  snapshot,
  finish,
}: {
  snapshot: CapabilitySnapshot;
  finish: (result: SetupFlowResult, prefs: SetupPrefs) => void;
}) {
  const { cols, rows } = useShellDimensions();

  const [slideIdx, setSlideIdx] = useState(0);
  const [audioIdx, setAudioIdx] = useState(0);
  const [subtitleIdx, setSubtitleIdx] = useState(0);
  const [downloadsIdx, setDownloadsIdx] = useState(0);

  const slide = SLIDE_ORDER[slideIdx] as Slide;
  const isPickerSlide =
    slide === "prefs-audio" || slide === "prefs-subtitle" || slide === "downloads";

  function buildPrefs(): SetupPrefs {
    return {
      audio: AUDIO_OPTS[audioIdx]?.value ?? "original",
      subtitle: SUBTITLE_OPTS[subtitleIdx]?.value ?? "en",
      downloadsEnabled: downloadsIdx === 0,
    };
  }

  function advance() {
    if (slideIdx < SLIDE_ORDER.length - 1) {
      setSlideIdx((current) => current + 1);
    } else {
      finish("completed", buildPrefs());
    }
  }

  function back() {
    if (slideIdx > 0) setSlideIdx((i) => i - 1);
  }

  function skip() {
    finish("skipped", buildPrefs());
  }

  useInput((input, key) => {
    if (key.escape) {
      skip();
      return;
    }

    if (input === "s" || input === "S") {
      skip();
      return;
    }

    if (input === "q" || input === "Q") {
      skip();
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

        {slide === "welcome" ? <WelcomeSlide width={cols} rows={rows - 2} /> : null}
        {slide === "system" ? (
          <SystemSlide width={cols} rows={rows - 2} snapshot={snapshot} />
        ) : null}
        {slide === "prefs-audio" ? (
          <PickerSlide
            width={cols}
            rows={rows - 2}
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
            rows={rows - 2}
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
            rows={rows - 2}
            ytDlpReady={snapshot.ytDlp}
            selectedIndex={downloadsIdx}
          />
        ) : null}
        {slide === "tips" ? <TipsSlide width={cols} rows={rows - 2} /> : null}
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
    fallbackValue: {
      outcome: "skipped",
      prefs: { audio: "original", subtitle: "en", downloadsEnabled: false },
    },
  });

  return { result: mounted.result };
}
