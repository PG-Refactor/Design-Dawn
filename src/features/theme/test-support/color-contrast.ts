// WCAG 2.x contrast helpers for the token tests.

const HEX_COLOR_PATTERN = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const HEX_RADIX = 16;
const CHANNEL_MAX = 255;
const LINEAR_THRESHOLD = 0.03928;
const LINEAR_DIVISOR = 12.92;
const GAMMA_OFFSET = 0.055;
const GAMMA_DIVISOR = 1.055;
const GAMMA_EXPONENT = 2.4;
const LUMINANCE_WEIGHTS = [0.2126, 0.7152, 0.0722] as const;
const CONTRAST_OFFSET = 0.05;

export type Rgb = readonly [number, number, number];

// Null when the text is not a #rrggbb colour.
export function parseHexColor(text: string): Rgb | null {
  const match = HEX_COLOR_PATTERN.exec(text.trim());
  if (match === null) return null;
  return [1, 2, 3].map((index) =>
    Number.parseInt(match[index] ?? "0", HEX_RADIX),
  ) as unknown as Rgb;
}

function linearChannel(channel: number): number {
  const normalized = channel / CHANNEL_MAX;
  return normalized <= LINEAR_THRESHOLD
    ? normalized / LINEAR_DIVISOR
    : ((normalized + GAMMA_OFFSET) / GAMMA_DIVISOR) ** GAMMA_EXPONENT;
}

export function relativeLuminance(color: Rgb): number {
  return color.reduce(
    (sum, channel, index) =>
      sum + linearChannel(channel) * (LUMINANCE_WEIGHTS[index] ?? 0),
    0,
  );
}

export function contrastRatio(first: Rgb, second: Rgb): number {
  const [lighter, darker] = [
    relativeLuminance(first),
    relativeLuminance(second),
  ].sort((a, b) => b - a);
  return ((lighter ?? 0) + CONTRAST_OFFSET) / ((darker ?? 0) + CONTRAST_OFFSET);
}
