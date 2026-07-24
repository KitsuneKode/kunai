import type { TitleDetail } from "@/domain/catalog/title-detail";
import { Box, Text } from "ink";
import React from "react";

import type { DetailsPanelData, DetailsPanelSecondary } from "./details-panel";
import {
  buildDetailCastLines,
  buildDetailFactRows,
  buildDetailSubtitle,
  resolvePosterUrl,
  wrapSynopsis,
} from "./details-view";
import { PosterInitialBlock } from "./poster-initial-block";
import { SakuraPetal } from "./primitives/SakuraPetal";
import { padColumnsEnd, truncateAtWord, truncateLine } from "./shell-text";
import { palette, semanticToneColor } from "./shell-theme";
import type { ShellPanelLine } from "./types";
import { usePosterPreview } from "./use-poster-preview";

type SeriesStateKey = NonNullable<DetailsPanelSecondary["seriesState"]>;

const SERIES_STATE_COLORS: Record<SeriesStateKey, string> = {
  airing: palette.muted,
  ended: palette.ok,
  complete: palette.milestone,
  upcoming: palette.muted,
};

const SERIES_STATE_LABELS: Record<SeriesStateKey, string> = {
  airing: "◉ airing",
  ended: "✦ ended",
  complete: "✦ you finished this",
  upcoming: "upcoming",
};

function SecondaryZoneShimmer() {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>{"░".repeat(28)}</Text>
      <Text dimColor>{"░".repeat(20)}</Text>
      <Text dimColor>{"░".repeat(24)}</Text>
    </Box>
  );
}

const DETAIL_FACT_LABEL_WIDTH = 10;

function FactRow({ label, value, width }: { label: string; value: string; width: number }) {
  const labelWidth = Math.min(DETAIL_FACT_LABEL_WIDTH, Math.max(6, label.length + 1));
  return (
    <Box>
      <Text color={palette.dim}>{padColumnsEnd(truncateLine(label, labelWidth), labelWidth)}</Text>
      <Text color={palette.text}>{truncateLine(value, width - labelWidth - 2)}</Text>
    </Box>
  );
}

function sheetLineColor(tone: ShellPanelLine["tone"]): string {
  if (!tone || tone === "neutral") return palette.text;
  return semanticToneColor(tone);
}

export function DetailsSheetUI({
  data,
  lines,
  width = 48,
  scrollIndex = 0,
  maxVisibleLines = 12,
}: {
  readonly data: DetailsPanelData;
  readonly lines: readonly ShellPanelLine[];
  readonly width?: number;
  readonly scrollIndex?: number;
  readonly maxVisibleLines?: number;
}) {
  const { primary } = data;
  const headerLines = [
    primary.title,
    [primary.type, primary.year, ...(primary.genres?.slice(0, 3) ?? [])]
      .filter(Boolean)
      .join(" · "),
    primary.synopsis ? truncateAtWord(primary.synopsis, width * 2) : undefined,
  ].filter((line): line is string => Boolean(line));
  const bodyStart = headerLines.length;
  const scrollable = lines.slice(bodyStart);
  const maxScroll = Math.max(0, scrollable.length - maxVisibleLines);
  const clampedScroll = Math.min(scrollIndex, maxScroll);
  const visible = scrollable.slice(clampedScroll, clampedScroll + maxVisibleLines);

  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="single"
      borderColor={palette.line}
      paddingX={1}
    >
      <Text color={palette.text} bold>
        {truncateLine(primary.title, width - 2)}
      </Text>
      <Text color={palette.muted}>
        {[primary.type, primary.year, ...(primary.genres?.slice(0, 3) ?? [])]
          .filter(Boolean)
          .join(" · ")}
      </Text>
      {primary.synopsis ? (
        <Box marginTop={1}>
          <Text color={palette.dim}>{truncateAtWord(primary.synopsis, width * 2)}</Text>
        </Box>
      ) : null}
      <Box marginTop={1} flexDirection="column">
        {visible.map((line) =>
          line.detail === "" && line.label.startsWith("───") ? (
            <Text key={line.label} color={palette.muted}>
              {line.label}
            </Text>
          ) : (
            <Box key={`${line.label}:${line.detail ?? ""}`}>
              <Text color={palette.dim}>
                {padColumnsEnd(
                  truncateLine(line.label, DETAIL_FACT_LABEL_WIDTH),
                  DETAIL_FACT_LABEL_WIDTH,
                )}
              </Text>
              <Text color={sheetLineColor(line.tone)}>
                {truncateLine(line.detail ?? "", width - DETAIL_FACT_LABEL_WIDTH - 2)}
              </Text>
            </Box>
          ),
        )}
      </Box>
      {scrollable.length > maxVisibleLines ? (
        <Text color={palette.dim} dimColor>
          {clampedScroll > 0 ? "▲ " : ""}
          {clampedScroll < maxScroll ? "▼ scroll" : ""}
        </Text>
      ) : null}
    </Box>
  );
}

export function DetailsPaneUI({
  data,
  width = 36,
  posterRows = 10,
  posterCols = 22,
}: {
  data: DetailsPanelData;
  width?: number;
  posterRows?: number;
  posterCols?: number;
}) {
  const { primary, secondary } = data;
  const { poster, spinner } = usePosterPreview(primary.posterPath ?? undefined, {
    rows: posterRows,
    cols: posterCols,
    enabled: Boolean(primary.posterPath),
    debounceMs: 90,
    variant: "detail",
    placementSlot: "details-primary",
  });
  const seriesState = secondary?.seriesState ?? null;
  const seriesStateColor = seriesState ? SERIES_STATE_COLORS[seriesState] : palette.dim;

  return (
    <Box flexDirection="row" width={width}>
      <Box width={1} marginRight={1}>
        <Text color={seriesStateColor}>{"│"}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        <Box marginBottom={1}>
          {poster.kind !== "none" ? (
            <Text>{poster.placeholder}</Text>
          ) : primary.posterPath && spinner ? (
            <SakuraPetal mode="loading" />
          ) : (
            // No poster URL, a cache hit still painting, or a failed fetch — the
            // initials block is the honest resting state. A spinner that never
            // resolves reads as a hang.
            <PosterInitialBlock title={primary.title} width={8} height={4} />
          )}
        </Box>
        <Text bold>{truncateLine(primary.title, width - 4)}</Text>
        <Text color={palette.dim}>
          {[primary.type, primary.year, ...(primary.genres?.slice(0, 2) ?? [])]
            .filter(Boolean)
            .join(" · ")}
        </Text>
        <Box marginTop={1}>
          {primary.synopsis ? (
            <Text color={palette.dim}>{truncateAtWord(primary.synopsis, (width - 4) * 3)}</Text>
          ) : (
            <Text color={palette.dim} dimColor>
              No synopsis available
            </Text>
          )}
        </Box>

        {secondary === null ? (
          <SecondaryZoneShimmer />
        ) : (
          <Box flexDirection="column" marginTop={1}>
            {secondary.seriesState && (
              <Text color={SERIES_STATE_COLORS[secondary.seriesState]}>
                {SERIES_STATE_LABELS[secondary.seriesState]}
                {secondary.nextAirDate ? `  ·  ${secondary.nextAirDate}` : ""}
              </Text>
            )}
            {secondary.seasonLabel || secondary.totalEpisodes !== undefined ? (
              <FactRow
                label="Season"
                value={
                  [
                    secondary.seasonLabel,
                    secondary.totalEpisodes !== undefined
                      ? `${secondary.totalEpisodes} eps`
                      : undefined,
                    secondary.watchedEpisodes !== undefined
                      ? `${secondary.watchedEpisodes} watched`
                      : undefined,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"
                }
                width={width - 4}
              />
            ) : null}
            {secondary.providers && secondary.providers.length > 0 ? (
              <FactRow label="Provider" value={secondary.providers.join(" · ")} width={width - 4} />
            ) : null}
            {secondary.subtitleLanguages && secondary.subtitleLanguages.length > 0 ? (
              <FactRow
                label="Sub"
                value={secondary.subtitleLanguages.join(" · ")}
                width={width - 4}
              />
            ) : null}
          </Box>
        )}
      </Box>
    </Box>
  );
}

// =============================================================================
// TitleDetailSheetUI — full-surface [i] detail view from a TitleDetail prop
// =============================================================================

/** Separator drawn between sections of the detail sheet. */
function SectionDivider({ width }: { readonly width: number }) {
  return (
    <Box marginTop={1}>
      <Text color={palette.line}>{"─".repeat(Math.max(2, width))}</Text>
    </Box>
  );
}

/** One labelled fact row: muted label + text value. */
function DetailFact({
  label,
  value,
  labelWidth,
  valueWidth,
  tone,
}: {
  readonly label: string;
  readonly value: string;
  readonly labelWidth: number;
  readonly valueWidth: number;
  readonly tone?: "success" | "warning" | "muted";
}) {
  const valueColor =
    tone === "success"
      ? palette.ok
      : tone === "warning"
        ? semanticToneColor("warning")
        : palette.text;
  const displayValue = value === "—" ? value : truncateLine(value, valueWidth);
  return (
    <Box>
      <Text color={palette.dim}>{padColumnsEnd(truncateLine(label, labelWidth), labelWidth)}</Text>
      <Text color={value === "—" ? palette.dim : valueColor} dimColor={value === "—"}>
        {displayValue}
      </Text>
    </Box>
  );
}

/** Poster slot — always reserves height so metadata never jumps on load. */
function DetailPosterSlot({
  detail,
  posterRows,
  posterCols,
}: {
  readonly detail: TitleDetail;
  readonly posterRows: number;
  readonly posterCols: number;
}) {
  const posterUrl = resolvePosterUrl(detail);
  const { poster, spinner } = usePosterPreview(posterUrl, {
    rows: posterRows,
    cols: posterCols,
    enabled: Boolean(posterUrl),
    debounceMs: 90,
    variant: "detail",
    placementSlot: "details-secondary",
  });

  if (poster.kind !== "none") {
    return (
      <Box minHeight={posterRows}>
        <Text>{poster.placeholder}</Text>
      </Box>
    );
  }

  if (spinner) {
    return (
      <Box minHeight={posterRows} width={posterCols} justifyContent="center" alignItems="center">
        <SakuraPetal mode="loading" />
      </Box>
    );
  }

  // No poster — initial-block fallback, same height reserved
  return (
    <Box minHeight={posterRows} alignItems="flex-start">
      <PosterInitialBlock title={detail.title} width={posterCols} height={posterRows} />
    </Box>
  );
}

/** Cast list — up to maxCast rows, voice-actor labelled. */
function CastSection({
  detail,
  innerWidth,
}: {
  readonly detail: TitleDetail;
  readonly innerWidth: number;
}) {
  const castLines = buildDetailCastLines(detail, 6);
  if (castLines.length === 0) return null;

  const labelWidth = 12;
  const valueWidth = Math.max(8, innerWidth - labelWidth - 2);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={palette.muted}>Cast</Text>
      {castLines.map((member) => {
        const nameStr = truncateLine(member.name, labelWidth + valueWidth);
        const roleStr = member.role
          ? truncateLine(`as ${member.role}`, Math.max(4, valueWidth - nameStr.length - 3))
          : undefined;
        return (
          <Box key={`${member.name}:${member.role ?? ""}`}>
            <Text color={palette.text}>{truncateLine(member.name, labelWidth + valueWidth)}</Text>
            {roleStr ? (
              <Text color={palette.dim}>
                {"  "}
                {roleStr}
              </Text>
            ) : null}
            {member.kind === "voice" ? (
              <Text color={palette.dim} dimColor>
                {" "}
                {"(VA)"}
              </Text>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
}

/** Provider-evidence section — availability + subtitle evidence. */
function ProviderEvidenceSection({
  providers,
  subtitleLanguages,
  innerWidth,
}: {
  readonly providers: readonly string[] | undefined;
  readonly subtitleLanguages: readonly string[] | undefined;
  readonly innerWidth: number;
}) {
  const hasEvidence =
    (providers && providers.length > 0) || (subtitleLanguages && subtitleLanguages.length > 0);
  if (!hasEvidence) return null;

  const labelWidth = 10;
  const valueWidth = Math.max(8, innerWidth - labelWidth - 2);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={palette.muted}>Availability</Text>
      {providers && providers.length > 0 ? (
        <DetailFact
          label={"Provider"}
          value={providers.join(" · ")}
          labelWidth={labelWidth}
          valueWidth={valueWidth}
        />
      ) : null}
      {subtitleLanguages && subtitleLanguages.length > 0 ? (
        <DetailFact
          label={"Subtitles"}
          value={subtitleLanguages.join(" · ")}
          labelWidth={labelWidth}
          valueWidth={valueWidth}
        />
      ) : null}
    </Box>
  );
}

/**
 * Full-surface Details sheet rendered from a {@link TitleDetail} domain object.
 *
 * Prop shape:
 * ```ts
 * {
 *   detail: TitleDetail;           // required — the domain object to render
 *   width?: number;                // terminal column budget (default 76)
 *   posterRows?: number;           // poster height in rows (default 10)
 *   posterCols?: number;           // poster width in cols (default 20)
 *   scrollIndex?: number;          // scroll offset for long content
 *   maxBodyLines?: number;         // max visible scrollable body rows (default 20)
 *   providers?: readonly string[]; // provider-ready evidence
 *   subtitleLanguages?: readonly string[]; // subtitle language evidence
 * }
 * ```
 *
 * Callers wire [i] → mount this with the selected title's TitleDetail.
 * The component is idle-stable (no timers, no polling effects beyond poster).
 */
export function TitleDetailSheetUI({
  detail,
  width = 76,
  posterRows = 10,
  posterCols = 20,
  providers,
  subtitleLanguages,
}: {
  readonly detail: TitleDetail;
  readonly width?: number;
  readonly posterRows?: number;
  readonly posterCols?: number;
  readonly providers?: readonly string[];
  readonly subtitleLanguages?: readonly string[];
}) {
  // Inner content width: border (2) + paddingX (2) = 4 chars overhead
  const innerWidth = Math.max(16, width - 4);
  const factLabelWidth = 8;
  const factValueWidth = Math.max(8, innerWidth - factLabelWidth - 2);

  const subtitle = buildDetailSubtitle(detail);
  const synopsisLines = wrapSynopsis(detail.synopsis, innerWidth, 4);
  const factRows = buildDetailFactRows(detail);

  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="single"
      borderColor={palette.line}
      paddingX={1}
    >
      {/* ---- Poster slot ---- */}
      <Box marginBottom={1}>
        <DetailPosterSlot detail={detail} posterRows={posterRows} posterCols={posterCols} />
      </Box>

      {/* ---- Title (bright + bold — weight carries hierarchy) ---- */}
      <Text color={palette.text} bold>
        {truncateLine(detail.title, innerWidth)}
      </Text>

      {/* ---- Subtitle: type · year · rating ---- */}
      <Text color={palette.muted}>{truncateLine(subtitle, innerWidth)}</Text>

      {/* ---- Synopsis ---- */}
      <Box marginTop={1} flexDirection="column">
        {synopsisLines.length > 0 ? (
          synopsisLines.map(
            (() => {
              const seen = new Map<string, number>();
              return (line) => {
                const count = seen.get(line) ?? 0;
                seen.set(line, count + 1);
                return (
                  <Text key={`synopsis:${line}:${count}`} color={palette.dim}>
                    {line}
                  </Text>
                );
              };
            })(),
          )
        ) : (
          <Text color={palette.dim} dimColor>
            {"No synopsis available"}
          </Text>
        )}
      </Box>

      {/* ---- Fact rows ---- */}
      <SectionDivider width={innerWidth} />
      <Box flexDirection="column" marginTop={1}>
        {factRows.map((row) => (
          <DetailFact
            key={row.label}
            label={row.label}
            value={row.value}
            labelWidth={factLabelWidth}
            valueWidth={factValueWidth}
            tone={row.tone}
          />
        ))}
      </Box>

      {/* ---- Cast ---- */}
      {detail.cast && detail.cast.length > 0 ? (
        <>
          <SectionDivider width={innerWidth} />
          <CastSection detail={detail} innerWidth={innerWidth} />
        </>
      ) : null}

      {/* ---- Provider evidence ---- */}
      {(providers && providers.length > 0) ||
      (subtitleLanguages && subtitleLanguages.length > 0) ? (
        <>
          <SectionDivider width={innerWidth} />
          <ProviderEvidenceSection
            providers={providers}
            subtitleLanguages={subtitleLanguages}
            innerWidth={innerWidth}
          />
        </>
      ) : null}

      {/* ---- Footer hint ---- */}
      <Box marginTop={1}>
        <Text color={palette.dim} dimColor>
          {"[i] close · [/] commands"}
        </Text>
      </Box>
    </Box>
  );
}
