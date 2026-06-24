"use client";

import dynamic from "next/dynamic";

import type { HomeCommandMetadata, HomeProviderMetadata } from "./types";

const TerminalSimulator = dynamic(
  () => import("./terminal-simulator").then((mod) => mod.TerminalSimulator),
  {
    ssr: false,
    loading: () => <div className="kunai-terminal-shell min-h-[360px] animate-pulse rounded-2xl" />,
  },
);

type HomeTerminalIslandProps = {
  readonly providers: readonly HomeProviderMetadata[];
  readonly paletteCommands: readonly HomeCommandMetadata[];
  readonly allCommands: readonly HomeCommandMetadata[];
  readonly cliVersion: string;
  readonly runtimeBaseline: { readonly bun: string; readonly mpv: string };
};

export function HomeTerminalIsland({
  providers,
  paletteCommands,
  allCommands,
  cliVersion,
  runtimeBaseline,
}: HomeTerminalIslandProps) {
  return (
    <TerminalSimulator
      providers={providers}
      paletteCommands={paletteCommands}
      allCommands={allCommands}
      cliVersion={cliVersion}
      runtimeBaseline={runtimeBaseline}
    />
  );
}
