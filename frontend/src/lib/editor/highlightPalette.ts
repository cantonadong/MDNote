// Color grid for the text-highlight picker: a 10-step grayscale row plus 7
// rows of 10 hue columns (row 0 = the vivid "pure" anchor color, rows 1-2
// lighter tints above it, rows 3-6 progressively darker shades below) —
// the same general layout as the highlight-color pickers in mainstream
// office suites. Generated from HSL rather than ~80 hand-picked hex
// constants so the tint/shade ramp stays visually consistent across columns.

function hslToHex(h: number, s: number, l: number): string {
  const sNorm = s / 100;
  const lNorm = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sNorm * Math.min(lNorm, 1 - lNorm);
  const f = (n: number) => lNorm - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

// Base hue/saturation for the 10 columns: dark red, red, orange, yellow,
// green, cyan, blue, indigo, purple, magenta.
const BASE_HUE = [355, 0, 30, 50, 130, 190, 217, 235, 275, 320];
const BASE_SAT = [70, 85, 90, 85, 60, 80, 85, 80, 70, 75];

const ROW_LIGHTNESS = [50, 85, 72, 58, 44, 32, 20];

export const GRAYSCALE_ROW: string[] = [
  "#000000",
  "#2b2b2b",
  "#444444",
  "#5e5e5e",
  "#787878",
  "#939393",
  "#aeaeae",
  "#c9c9c9",
  "#e4e4e4",
  "#ffffff",
];

export const COLOR_ROWS: string[][] = ROW_LIGHTNESS.map((lightness) =>
  BASE_HUE.map((h, col) => hslToHex(h, BASE_SAT[col], lightness)),
);
