import type { TitleDetail } from "@/domain/catalog/title-detail";
import { Box, Text } from "ink";
import React from "react";

import type { DetailsPanelData } from "./details-panel";
import {
  buildDetailCastLines,
  buildDetailFactRows,
  buildDetailSubtitle,
  resolvePosterUrl,
  wrapSynopsis,
} from "./details-view";
import { plainBorderStyle, plainModeEnabled } from "./plain-mode";
import { PosterInitialBlock } from "./poster-initial-block";
import { SakuraPetal } from "./primitives/SakuraPetal";
import { padColumnsEnd, truncateAtWord, truncateLine } from "./shell-text";
import { palette, semanticToneColor } from "./shell-theme";
import { PosterOutput } from "./SixelPosterPane";
import type { ShellPanelLine } from "./types";
import { usePosterPreview } from "./use-poster-preview";

const DETAIL_FACT_LABEL_WIDTH = 10;

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

  const plain = plainModeEnabled();
  return (
    // The bordered card may shrink to the rows its slot leaves; the content
    // column never does. Shrinking each row instead let Ink paint text over
    // text whenever the card was taller than its slot (medium-width browse).
    <Box
      flexDirection="column"
      width={width}
      borderStyle={plainBorderStyle("single", plain)}
      borderColor={plain ? undefined : palette.line}
      paddingX={plain ? 0 : 1}
      overflow="hidden"
    >
      <Box flexDirection="column" flexShrink={0}>
        <Text color={palette.text} bold>
          {truncateLine(primary.title, width - 2)}
        </Text>
        <Text color={palette.muted}>
          {[primary.type, primary.year, ...(primary.genres?.slice(0, 3) ?? [])]
            .filter(Boolean)
            .join(plain ? ", " : " · ")}
        </Text>
        {primary.synopsis ? (
          <Box marginTop={1}>
            <Text color={palette.dim}>{truncateAtWord(primary.synopsis, width * 2)}</Text>
          </Box>
        ) : null}
        <Box marginTop={1} flexDirection="column">
          {visible.map((line) =>
            line.detail === "" && line.label.startsWith("───") ? (
              plain ? (
                <Text key={line.label} color={palette.text} bold>
                  {line.label.replace(/^─+\s*|\s*─+$/gu, "")}
                </Text>
              ) : (
                <Text key={line.label} color={palette.muted}>
                  {line.label}
                </Text>
              )
            ) : plain ? (
              <Text key={`${line.label}:${line.detail ?? ""}`} color={sheetLineColor(line.tone)}>
                {line.detail ? `${line.label}: ${line.detail}` : line.label}
              </Text>
            ) : (
              <Box key={`${line.label}:${line.detail ?? ""}`}>
                <Text color={palette.dim}>
                  {padColumnsEnd(
                    truncateLine(line.label, DETAIL_FACT_LABEL_WIDTH),
                    DETAIL_FACT_LABEL_WIDTH,
                  )}{" "}
                </Text>
                <Text color={sheetLineColor(line.tone)}>
                  {/* Border (2) + padding (2) + the gap after the label (1). At -3
                      the value overran the row by two columns and wrapped. */}
                  {truncateLine(line.detail ?? "", width - DETAIL_FACT_LABEL_WIDTH - 5)}
                </Text>
              </Box>
            ),
          )}
        </Box>
        {scrollable.length > maxVisibleLines ? (
          <Text color={palette.dim} dimColor={!plain}>
            {plain
              ? [
                  clampedScroll > 0 ? "More above" : "",
                  clampedScroll < maxScroll ? "More below" : "",
                ]
                  .filter(Boolean)
                  .join(", ")
              : `${clampedScroll > 0 ? "▲ " : ""}${clampedScroll < maxScroll ? "▼ scroll" : ""}`}
          </Text>
        ) : null}
      </Box>
    </Box>
  );
}

// =============================================================================
// TitleDetailSheetUI — full-surface [i] detail view from a TitleDetail prop
// =============================================================================

/** Separator drawn between sections of the detail sheet. */
function SectionDivider({ width }: { readonly width: number }) {
  if (plainModeEnabled()) return null;
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
        <PosterOutput poster={poster} />
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
  const plain = plainModeEnabled();
  // Inner content width: border (2) + paddingX (2) = 4 chars overhead
  const innerWidth = Math.max(16, width - (plain ? 0 : 4));
  const factLabelWidth = 8;
  const factValueWidth = Math.max(8, innerWidth - factLabelWidth - 2);

  const subtitle = buildDetailSubtitle(detail);
  const synopsisLines = wrapSynopsis(detail.synopsis, innerWidth, 4);
  const factRows = buildDetailFactRows(detail);

  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle={plainBorderStyle("single", plain)}
      borderColor={plain ? undefined : palette.line}
      paddingX={plain ? 0 : 1}
    >
      {/* ---- Poster slot ---- */}
      {plain ? null : (
        <Box marginBottom={1}>
          <DetailPosterSlot detail={detail} posterRows={posterRows} posterCols={posterCols} />
        </Box>
      )}

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
