// Colour mathematics for the sensory algorithm. Pure functions over hex strings, with no
// pipeline or domain knowledge. See docs/rules/sensory.md (Colour).
//
// Mixing uses Kubelka-Munk reflectance rather than a channel average. Averaging treats a
// pale pigment and a dense one as equals, which is not how pigment behaves: a small amount
// of a dark pigment dominates a pale one well out of proportion to its share. Averaging
// also converges on similar muddy browns regardless of input.

export type Rgb = [number, number, number];

// Reflectance is clamped away from 0 and 1 because the Kubelka-Munk ratio divides by it.
const FLOOR = 0.005;
const CEIL = 0.995;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function parseHex(hex: string): Rgb {
  const h = hex.trim();
  const n = Number.parseInt(h.slice(1), 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

export function toHex(rgb: Rgb): string {
  const part = (v: number) =>
    Math.round(clamp(v, 0, 1) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${part(rgb[0])}${part(rgb[1])}${part(rgb[2])}`.toUpperCase();
}

// Relative luminance with sRGB coefficients. Used to decide how much a metal oxide darkens
// a tannate complex: dark oxides make ink, white ones make a pale lake pigment.
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function toKs(reflectance: number): number {
  const r = clamp(reflectance, FLOOR, CEIL);
  return ((1 - r) * (1 - r)) / (2 * r);
}

function fromKs(ks: number): number {
  return 1 + ks - Math.sqrt(ks * ks + 2 * ks);
}

// Weighted subtractive mix. Weights are normalized internally, so callers pass raw
// contribution weights and do not need to pre-divide. Entries with non-positive weight are
// dropped so a zero-weight participant cannot skew the normalization.
export function blend(colors: string[], weights: number[]): string {
  const parts: Array<{ rgb: Rgb; weight: number }> = [];
  let total = 0;
  for (let i = 0; i < colors.length; i++) {
    const color = colors[i];
    const w = weights[i] ?? 0;
    if (color === undefined || w <= 0) continue;
    parts.push({ rgb: parseHex(color), weight: w });
    total += w;
  }
  if (parts.length === 0) return '#000000';

  const out: Rgb = [0, 0, 0];
  const channels: Array<0 | 1 | 2> = [0, 1, 2];
  for (const channel of channels) {
    let ks = 0;
    for (const part of parts) ks += toKs(part.rgb[channel]) * (part.weight / total);
    out[channel] = fromKs(ks);
  }
  return toHex(out);
}

// Mixes `base` toward `target` by `amount` (0..1) using the same subtractive model, so a
// reactive shift and an ingredient blend behave consistently.
export function shiftToward(base: string, target: string, amount: number): string {
  const a = clamp(amount, 0, 1);
  if (a <= 0) return base.toUpperCase();
  return blend([base, target], [1 - a, a]);
}

// ---- HSL, used only by the Prism spectrum ----

function toHsl(rgb: Rgb): [number, number, number] {
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hueToRgb(p: number, q: number, t: number): number {
  let x = t;
  if (x < 0) x += 1;
  if (x > 1) x -= 1;
  if (x < 1 / 6) return p + (q - p) * 6 * x;
  if (x < 1 / 2) return q;
  if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
  return p;
}

function fromHsl(h: number, s: number, l: number): Rgb {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hueToRgb(p, q, h + 1 / 3), hueToRgb(p, q, h), hueToRgb(p, q, h - 1 / 3)];
}

// Rotates hue by `turns` (0..1 of the wheel) and optionally lifts saturation. Prism splits
// one input colour into a spectrum, so the rotation starts from the blended ingredient
// colour rather than from an arbitrary constant.
export function rotateHue(hex: string, turns: number, saturationFloor = 0): string {
  const [h, s, l] = toHsl(parseHex(hex));
  const rotated = (h + turns) % 1;
  return toHex(fromHsl(rotated < 0 ? rotated + 1 : rotated, Math.max(s, saturationFloor), l));
}

export function desaturate(hex: string, amount: number): string {
  const [h, s, l] = toHsl(parseHex(hex));
  return toHex(fromHsl(h, s * (1 - clamp(amount, 0, 1)), l));
}

// Scales every channel toward black. Used for Lacuna's darkening ground.
export function darken(hex: string, amount: number): string {
  const rgb = parseHex(hex);
  const k = 1 - clamp(amount, 0, 1);
  return toHex([rgb[0] * k, rgb[1] * k, rgb[2] * k]);
}

// Removes the yellow channel in subtractive space. Y = 1 - B, so stripping yellow pushes
// blue up, which is what leaves cyan and magenta behind. This is Lacuna's erasure expressed
// in the colour space the blend already uses, not a themed override.
export function stripYellow(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex);
  const a = clamp(amount, 0, 1);
  return toHex([r, g, b + (1 - b) * a]);
}
