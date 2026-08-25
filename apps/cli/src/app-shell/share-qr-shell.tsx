import { mountRootContent } from "@/app-shell/root-content-state";
import { ResizeBlocker, ShellFooter } from "@/app-shell/shell-primitives";
import { truncateLine } from "@/app-shell/shell-text";
import { palette } from "@/app-shell/shell-theme";
import { useShellDimensions } from "@/app-shell/use-viewport-policy";
import { encodeQrMatrix, renderQrHalfBlocks } from "@/domain/share/qr-code";
import { Box, Text, useInput } from "ink";
import React, { useMemo } from "react";

export function buildTerminalShareQr(url: string): string | null {
  try {
    return renderQrHalfBlocks(encodeQrMatrix(url));
  } catch {
    return null;
  }
}

function ShareQrShell({
  title,
  url,
  shortCode,
  onBack,
}: {
  readonly title: string;
  readonly url: string;
  readonly shortCode: string | null;
  readonly onBack: () => void;
}) {
  const { cols, rows } = useShellDimensions();
  const qr = useMemo(() => buildTerminalShareQr(url), [url]);
  const qrLines = qr?.split("\n") ?? [];
  const minimumColumns = Math.max(40, qrLines[0]?.length ?? 0);
  const minimumRows = qrLines.length + 4;

  useInput((input, key) => {
    if (key.escape || key.return || input.toLowerCase() === "q") onBack();
  });

  if (!qr) {
    return (
      <Box flexDirection="column" flexGrow={1} alignItems="center" justifyContent="center">
        <Text bold color={palette.text}>
          This share reference is too large for the terminal QR.
        </Text>
        <Text color={palette.muted}>The full HTTPS link is still on your clipboard.</Text>
        <ShellFooter
          taskLabel="Paste the copied link to share it"
          actions={[
            { key: "enter", label: "back", primary: true },
            { key: "esc", label: "close" },
          ]}
          mode="minimal"
          terminalWidth={cols}
        />
      </Box>
    );
  }

  if (cols < minimumColumns || rows < minimumRows) {
    return (
      <ResizeBlocker
        columns={cols}
        rows={rows}
        minColumns={minimumColumns}
        minRows={minimumRows}
        message="Terminal too small for this QR"
      />
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1} alignItems="center">
      <Text bold color={palette.text}>
        {truncateLine(`Scan to share · ${title}`, Math.max(24, cols - 4))}
      </Text>
      <Text color={palette.text}>{qr}</Text>
      <Text color={palette.muted}>{shortCode ? `Code ${shortCode}` : "HTTPS handoff"}</Text>
      <ShellFooter
        taskLabel="The full HTTPS link is also on your clipboard"
        actions={[
          { key: "enter", label: "back", primary: true },
          { key: "esc", label: "close" },
        ]}
        mode="minimal"
        terminalWidth={cols}
      />
    </Box>
  );
}

export function openShareQrShell(input: {
  readonly title: string;
  readonly url: string;
  readonly shortCode: string | null;
}): Promise<void> {
  const session = mountRootContent<undefined>({
    kind: "picker",
    headerLabel: "Share QR",
    renderContent: (finish) => <ShareQrShell {...input} onBack={() => finish(undefined)} />,
    fallbackValue: undefined,
  });
  return session.result;
}
