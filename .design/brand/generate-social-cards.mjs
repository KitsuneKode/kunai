// Generates Kunai social / OG card SVGs and PNG exports for docs + GitHub.
// Run: bun .design/brand/generate-social-cards.mjs

import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "../..");

const PALETTE = {
  bg: "#100b0f",
  surface: "#1c1620",
  surfaceElevated: "#2a2030",
  line: "#473b51",
  lineSoft: "#281f2e",
  text: "#f6eff4",
  textDim: "#cabfca",
  muted: "#968a98",
  accent: "#ff8fb0",
  accentDeep: "#d85f86",
  accentSoft: "#ffc6d8",
  accentFill: "#2c1622",
  accentGlow: "rgba(255,143,176,0.12)",
  typeAnime: "#c98bff",
  typeSeries: "#4fd1c5",
  typeMovie: "#f4c45c",
  info: "#5fb6ff",
};

const mascotBody = readFileSync(join(HERE, "kunai-mascot.svg"), "utf8")
  .replace(/[\s\S]*?<g>\s*/u, "")
  .replace(/\s*<\/g>[\s\S]*/u, "")
  .trim();

const markPaths = readFileSync(join(HERE, "kunai-mark.svg"), "utf8")
  .replace(/[\s\S]*?<svg[^>]*>/u, "")
  .replace(/<\/svg>[\s\S]*/u, "")
  .trim();

function gridOverlay(width, height) {
  const lines = [];
  for (let x = 80; x < width; x += 80) {
    lines.push(
      `<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="${PALETTE.lineSoft}" stroke-width="1" opacity="0.12"/>`,
    );
  }
  for (let y = 80; y < height; y += 80) {
    lines.push(
      `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="${PALETTE.lineSoft}" stroke-width="1" opacity="0.12"/>`,
    );
  }
  return lines.join("\n    ");
}

function kindDots(x, y) {
  return `
  <g font-family="ui-monospace, 'JetBrains Mono', Menlo, monospace" font-size="13" fill="${PALETTE.muted}">
    <circle cx="${x}" cy="${y}" r="5" fill="${PALETTE.typeAnime}"/>
    <text x="${x + 14}" y="${y + 4}">anime</text>
    <circle cx="${x + 88}" cy="${y}" r="5" fill="${PALETTE.typeSeries}"/>
    <text x="${x + 102}" y="${y + 4}">series</text>
    <circle cx="${x + 176}" cy="${y}" r="5" fill="${PALETTE.typeMovie}"/>
    <text x="${x + 190}" y="${y + 4}">movies</text>
  </g>`;
}

function terminalStrip({ x, y, width, command, prompt = ">" }) {
  return `
  <g>
    <rect x="${x}" y="${y}" width="${width}" height="56" rx="10" fill="${PALETTE.surface}" stroke="${PALETTE.line}" stroke-width="1"/>
    <rect x="${x}" y="${y}" width="${width}" height="22" rx="10" fill="${PALETTE.surfaceElevated}"/>
    <rect x="${x}" y="${y + 10}" width="${width}" height="12" fill="${PALETTE.surfaceElevated}"/>
    <circle cx="${x + 18}" cy="${y + 11}" r="4" fill="${PALETTE.accentDeep}" opacity="0.85"/>
    <circle cx="${x + 32}" cy="${y + 11}" r="4" fill="${PALETTE.muted}" opacity="0.45"/>
    <circle cx="${x + 46}" cy="${y + 11}" r="4" fill="${PALETTE.muted}" opacity="0.45"/>
    <text x="${x + 20}" y="${y + 44}" font-family="ui-monospace, 'JetBrains Mono', Menlo, monospace" font-size="18" fill="${PALETTE.textDim}">
      <tspan fill="${PALETTE.accent}">${prompt}</tspan> ${command}
    </text>
  </g>`;
}

function docsSocialCard(width, height) {
  const mascotScale = 2.35;
  const mascotX = 72;
  const mascotY = Math.round((height - 128 * mascotScale) / 2) - 8;
  const textX = 420;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Kunai Docs — terminal-first playback guides">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${PALETTE.bg}"/>
      <stop offset="100%" stop-color="${PALETTE.surfaceElevated}"/>
    </linearGradient>
    <radialGradient id="glow" cx="18%" cy="42%" r="48%">
      <stop offset="0%" stop-color="${PALETTE.accentGlow}"/>
      <stop offset="100%" stop-color="transparent"/>
    </radialGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <rect width="${width}" height="${height}" fill="url(#glow)"/>
  ${gridOverlay(width, height)}
  <g transform="translate(${mascotX} ${mascotY}) scale(${mascotScale})" shape-rendering="crispEdges">
    ${mascotBody}
  </g>
  <g transform="translate(72 56) scale(0.72)">
    ${markPaths}
  </g>
  <text x="${textX}" y="118" font-family="ui-monospace, 'JetBrains Mono', Menlo, monospace" font-size="22" letter-spacing="7" fill="${PALETTE.accent}">KUNAI DOCS</text>
  <text x="${textX}" y="214" font-family="ui-serif, 'Iowan Old Style', 'Palatino Linotype', Palatino, serif" font-size="58" font-weight="500" fill="${PALETTE.text}">Terminal-first</text>
  <text x="${textX}" y="278" font-family="ui-serif, 'Iowan Old Style', 'Palatino Linotype', Palatino, serif" font-size="58" font-weight="500" fill="${PALETTE.text}">playback guides</text>
  <text x="${textX}" y="332" font-family="ui-monospace, 'JetBrains Mono', Menlo, monospace" font-size="20" fill="${PALETTE.textDim}">Search · resolve streams · mpv handoff · clean recovery</text>
  ${terminalStrip({ x: textX, y: 372, width: 680, command: 'kunai -S "Your title"' })}
  ${kindDots(textX, height - 54)}
  <text x="${width - 72}" y="${height - 48}" text-anchor="end" font-family="ui-monospace, 'JetBrains Mono', Menlo, monospace" font-size="14" fill="${PALETTE.muted}">docs · kunai</text>
</svg>`;
}

function githubSocialCard(width, height) {
  const mascotScale = 2.55;
  const mascotX = 88;
  const mascotY = Math.round((height - 128 * mascotScale) / 2);
  const panelX = 470;
  const panelW = width - panelX - 72;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Kunai — terminal-first streaming CLI">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${PALETTE.bg}"/>
      <stop offset="55%" stop-color="#161019"/>
      <stop offset="100%" stop-color="${PALETTE.surfaceElevated}"/>
    </linearGradient>
    <radialGradient id="glow" cx="22%" cy="38%" r="55%">
      <stop offset="0%" stop-color="${PALETTE.accentGlow}"/>
      <stop offset="100%" stop-color="transparent"/>
    </radialGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <rect width="${width}" height="${height}" fill="url(#glow)"/>
  ${gridOverlay(width, height)}
  <rect x="${panelX - 24}" y="56" width="${panelW + 48}" height="${height - 112}" rx="18" fill="${PALETTE.surface}" stroke="${PALETTE.line}" stroke-width="1"/>
  <g transform="translate(${mascotX} ${mascotY}) scale(${mascotScale})" shape-rendering="crispEdges">
    ${mascotBody}
  </g>
  <g transform="translate(${panelX} 108)">
    <g transform="scale(1.05)">
      ${markPaths}
    </g>
    <text x="92" y="44" font-family="ui-monospace, 'JetBrains Mono', Menlo, monospace" font-size="68" font-weight="800" letter-spacing="8" fill="${PALETTE.accent}">KUNAI</text>
    <text x="94" y="88" font-family="ui-monospace, 'JetBrains Mono', Menlo, monospace" font-size="22" fill="${PALETTE.textDim}">Terminal-first streaming</text>
    <text x="94" y="118" font-family="ui-monospace, 'JetBrains Mono', Menlo, monospace" font-size="22" fill="${PALETTE.textDim}">Finds the playable stream</text>
    <text x="94" y="152" font-family="ui-monospace, 'JetBrains Mono', Menlo, monospace" font-size="17" fill="${PALETTE.muted}">Search · pick source · watch in mpv · download offline</text>
  </g>
  ${terminalStrip({ x: panelX, y: 286, width: panelW, command: "curl -fsSL …/install.sh | bash" })}
  ${terminalStrip({ x: panelX, y: 364, width: panelW, command: 'kunai -S "Dune"', prompt: "$" })}
  ${kindDots(panelX, height - 58)}
  <text x="${width - 88}" y="${height - 52}" text-anchor="end" font-family="ui-monospace, 'JetBrains Mono', Menlo, monospace" font-size="15" fill="${PALETTE.info}">github.com/KitsuneKode/kunai</text>
  <text x="88" y="${height - 52}" font-family="ui-monospace, 'JetBrains Mono', Menlo, monospace" font-size="13" letter-spacing="4" fill="${PALETTE.muted}">EMBER DUSK · SAKURA</text>
</svg>`;
}

function exportPng(svgPath, pngPath, width) {
  const result = spawnSync("rsvg-convert", ["-w", String(width), "-o", pngPath, svgPath], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`rsvg-convert failed for ${svgPath}`);
  }
}

const GITHUB_MAX_BYTES = 1_000_000;

function optimizePng(pngPath) {
  const result = spawnSync("oxipng", ["-o", "4", "-strip", "all", "-out", pngPath, pngPath], {
    stdio: "pipe",
    encoding: "utf8",
  });
  return result.status === 0;
}

function tryPngDownscale(pngPath, scalePercent) {
  const result = spawnSync(
    "magick",
    [pngPath, "-resize", `${scalePercent}%`, "-strip", pngPath],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new Error(
      `magick failed while downscaling GitHub social preview PNG to ${scalePercent}%`,
    );
  }
  optimizePng(pngPath);
}

/** GitHub social preview must stay under 1 MB. Prefer crisp PNG; fall back to high-quality JPEG. */
function exportGithubSocialUpload(pngPath, githubJpgPath) {
  const optimized = optimizePng(pngPath);
  let pngSize = readFileSync(pngPath).length;
  if (pngSize <= GITHUB_MAX_BYTES) {
    return { format: "png", path: pngPath, bytes: pngSize, optimized };
  }

  for (const scale of [95, 90]) {
    tryPngDownscale(pngPath, scale);
    pngSize = readFileSync(pngPath).length;
    if (pngSize <= GITHUB_MAX_BYTES) {
      return { format: "png", path: pngPath, bytes: pngSize, optimized: true, downscaled: scale };
    }
  }

  const qualities = [95, 92, 88];
  let lastSize = 0;
  for (const quality of qualities) {
    const result = spawnSync(
      "magick",
      [pngPath, "-strip", "-sampling-factor", "4:4:4", "-quality", String(quality), githubJpgPath],
      { stdio: "inherit" },
    );
    if (result.status !== 0) {
      throw new Error("magick failed while exporting GitHub social preview JPEG");
    }
    lastSize = readFileSync(githubJpgPath).length;
    if (lastSize <= GITHUB_MAX_BYTES) {
      unlinkSync(pngPath);
      console.warn(
        `GitHub social preview exceeded 1 MB as PNG; wrote JPEG fallback and removed oversized PNG at ${pngPath}`,
      );
      return { format: "jpg", path: githubJpgPath, bytes: lastSize, quality };
    }
  }

  throw new Error(
    `GitHub social preview still exceeds 1 MB after JPEG compression (${lastSize} bytes).`,
  );
}

const docsSvg = docsSocialCard(1200, 630);
const githubSvg = githubSocialCard(1280, 640);

const docsSvgPath = join(HERE, "kunai-social-docs.svg");
const githubSvgPath = join(HERE, "kunai-social-github.svg");
const githubPngPath = join(REPO, ".github/social-preview.png");
const githubJpgPath = join(REPO, ".github/social-preview.jpg");
const docsPngPath = join(HERE, "kunai-social-docs.png");

writeFileSync(docsSvgPath, docsSvg);
writeFileSync(githubSvgPath, githubSvg);

const mascotSvgPath = join(HERE, "kunai-mascot.svg");
const mascotOgPngPath = join(HERE, "kunai-mascot-og.png");

exportPng(docsSvgPath, docsPngPath, 1200);
exportPng(githubSvgPath, githubPngPath, 1280);
exportPng(mascotSvgPath, mascotOgPngPath, 320);

const githubUpload = exportGithubSocialUpload(githubPngPath, githubJpgPath);

console.log("Wrote:");
console.log(`  ${docsSvgPath}`);
console.log(`  ${docsPngPath}`);
console.log(`  ${githubSvgPath}`);
console.log(`  ${mascotOgPngPath}`);
console.log(
  `  GitHub upload: ${githubUpload.path} (${githubUpload.format}, ${githubUpload.bytes} bytes` +
    (githubUpload.quality ? `, q${githubUpload.quality}` : "") +
    ")",
);
