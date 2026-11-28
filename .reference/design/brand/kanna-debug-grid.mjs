// Grid overlay for a raw traced pose. Width is always the master coordinate
// box; height is the pose's own raw height, which is taller for the poses cut
// on the sheet's row gap rather than the square grid.
export function debugGridElements(width, height) {
  const elements = [];
  for (let x = 0; x <= width; x += 100) {
    elements.push(
      `<path d="M${x} 0V${height}" stroke="#38f" stroke-width="${x % 500 === 0 ? 2.5 : 1}"/>`,
      `<text x="${x + 3}" y="14" font-size="16" fill="#fff">${x}</text>`,
    );
  }
  for (let y = 0; y <= height; y += 100) {
    elements.push(
      `<path d="M0 ${y}H${width}" stroke="#38f" stroke-width="${y % 500 === 0 ? 2.5 : 1}"/>`,
      `<text x="3" y="${y + 16}" font-size="16" fill="#fff">${y}</text>`,
    );
  }
  return elements;
}

export function rawPoseHeight(svg, fallback) {
  return Number(/data-h="(\d+)"/u.exec(svg)?.[1] ?? fallback);
}
