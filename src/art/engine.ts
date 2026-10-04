/**
 * Tiny pixel-art engine.
 *
 * Sprites are authored as character maps (one char per pixel, "." = transparent) plus a palette.
 * They render as one SVG <path> per color with horizontal runs merged, so even large scenes stay
 * a handful of DOM nodes. Large scenes are drawn procedurally with PixelCanvas.
 */

export interface Sprite {
  w: number;
  h: number;
  rows: readonly string[];
  palette: Readonly<Record<string, string>>;
}

export interface SpriteLayer {
  key: string;
  fill: string;
  d: string;
}

const layerCache = new WeakMap<Sprite, SpriteLayer[]>();

export function sprite(rows: readonly string[], palette: Record<string, string>): Sprite {
  const w = Math.max(...rows.map((r) => r.length));
  return { w, h: rows.length, rows, palette };
}

export function spriteLayers(s: Sprite): SpriteLayer[] {
  const cached = layerCache.get(s);
  if (cached) return cached;
  const runs = new Map<string, string[]>();
  s.rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x]!;
      if (!(ch in s.palette)) {
        x++;
        continue;
      }
      let len = 1;
      while (row[x + len] === ch) len++;
      let list = runs.get(ch);
      if (!list) runs.set(ch, (list = []));
      list.push(`M${x} ${y}h${len}v1h-${len}z`);
      x += len;
    }
  });
  const layers = [...runs].map(([key, parts]) => ({ key, fill: s.palette[key]!, d: parts.join("") }));
  layerCache.set(s, layers);
  return layers;
}

/** Swap palette entries (e.g. hair or hoodie colors) without redrawing the sprite. */
export function recolor(s: Sprite, overrides: Record<string, string>): Sprite {
  return { ...s, palette: { ...s.palette, ...overrides } };
}

/** Mirror a sprite horizontally. */
export function flip(s: Sprite): Sprite {
  return { ...s, rows: s.rows.map((r) => r.padEnd(s.w, ".").split("").reverse().join("")) };
}

/** Deterministic PRNG so procedural scenes look the same on every visit. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A grid you can draw into with single-character colors, then turn into a Sprite. */
export class PixelCanvas {
  private readonly cells: string[];

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.cells = new Array<string>(w * h).fill(".");
  }

  set(x: number, y: number, c: string): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.cells[y * this.w + x] = c;
  }

  get(x: number, y: number): string {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return ".";
    return this.cells[y * this.w + x]!;
  }

  rect(x: number, y: number, w: number, h: number, c: string): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }

  hline(x: number, y: number, len: number, c: string): void {
    this.rect(x, y, len, 1, c);
  }

  vline(x: number, y: number, len: number, c: string): void {
    this.rect(x, y, 1, len, c);
  }

  /** Filled disc. `test` lets callers shade by position (e.g. dithered craters). */
  disc(cx: number, cy: number, r: number, c: string | ((x: number, y: number, d: number) => string | null)): void {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d > r) continue;
        const color = typeof c === "string" ? c : c(x, y, d);
        if (color) this.set(x, y, color);
      }
    }
  }

  /** Copy a character map onto the canvas; "." stays transparent. */
  stamp(rows: readonly string[], x: number, y: number, map: Record<string, string> = {}): void {
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const ch = row[i]!;
        if (ch === ".") continue;
        this.set(x + i, y + j, map[ch] ?? ch);
      }
    });
  }

  toSprite(palette: Record<string, string>): Sprite {
    const rows: string[] = [];
    for (let y = 0; y < this.h; y++) rows.push(this.cells.slice(y * this.w, (y + 1) * this.w).join(""));
    return { w: this.w, h: this.h, rows, palette };
  }
}
