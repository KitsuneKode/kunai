"use client";

import { DIMENSION_NOUN, ShareOverTime } from "@/components/analytics/share-over-time";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  SHARE_DIMENSIONS,
  type DocsAnalyticsSeries,
  type ShareDimension,
} from "@/lib/analytics-series";
import * as React from "react";

/**
 * One share-over-time card, switchable across the three breakdowns.
 *
 * Three sibling cards was the obvious layout and the wrong one: at this
 * population every breakdown is fully suppressed, so it would render the same
 * "below the floor" panel three times and read as a broken page. One card with
 * a dimension toggle states the fact once, and grows into three real charts as
 * each dimension clears the five-install floor.
 */

const TAB_LABEL: Readonly<Record<ShareDimension, string>> = {
  byVersion: "Version",
  byOs: "Platform",
  byArch: "Architecture",
};

export function ShareSection({ series }: { readonly series: DocsAnalyticsSeries }) {
  const [dimension, setDimension] = React.useState<ShareDimension>("byVersion");

  return (
    <Card className="@container/card">
      <CardHeader className="flex flex-col gap-2 @[440px]/card:grid">
        <CardTitle>Share over time</CardTitle>
        <CardDescription>
          Share of active installs by {DIMENSION_NOUN[dimension]}
          {dimension === "byVersion" ? ", oldest band at the bottom" : ", largest band first"}.
        </CardDescription>
        <CardAction>
          <ToggleGroup
            value={[dimension]}
            onValueChange={(next: string[]) => {
              const picked = next[0];
              if (picked) setDimension(picked as ShareDimension);
            }}
            variant="outline"
            size="sm"
            spacing={0}
          >
            {SHARE_DIMENSIONS.map((key) => (
              <ToggleGroupItem key={key} value={key} className="px-3">
                {TAB_LABEL[key]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 sm:px-6">
        <ShareOverTime series={series} dimension={dimension} />
      </CardContent>
    </Card>
  );
}
