import { mulberry32, PixelCanvas, type Sprite } from "./engine";

/**
 * Procedural pixel scenes. Generated once (seeded, so they never change between visits)
 * and cached. Parts that animate use their own palette keys so CSS can target them.
 */

function memo<T>(make: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= make());
}

/* ── Moon ─────────────────────────────────────────────────────────────────── */

export const moon = memo((): Sprite => {
  const r = 22;
  const c = new PixelCanvas(r * 2 + 2, r * 2 + 2);
  const cx = r + 1;
  const cy = r + 1;
  c.disc(cx, cy, r, (x, y, d) => {
    const lx = x + 0.5 - cx;
    const ly = y + 0.5 - cy;
    const shade = (lx + ly) / r; // light comes from the upper left
    if (d > r - 1) return "o";
    if (shade > 0.85) return (x + y) % 2 ? "M" : "D";
    if (shade > 0.55) return "M";
    if (shade < -0.75 && (x + y) % 2 === 0) return "h";
    return "m";
  });
  const craters: [number, number, number][] = [
    [cx - 7, cy - 4, 4],
    [cx + 6, cy + 3, 5],
    [cx - 2, cy + 10, 3],
    [cx + 9, cy - 9, 2.5],
    [cx - 11, cy + 6, 2],
  ];
  for (const [x0, y0, cr] of craters) {
    c.disc(x0, y0, cr, (x, y, d) => {
      if (c.get(x, y) === "o") return null;
      return d > cr - 1.1 && x + y < x0 + y0 ? "C" : "c";
    });
  }
  return c.toSprite({ o: "#b79cf0", h: "#ffffff", m: "#efe6ff", M: "#cdb8f7", D: "#a98be8", c: "#d4c2fa", C: "#b9a2ef" });
});

/* ── City skyline (hero horizon) ──────────────────────────────────────────── */

export const skyline = memo((): Sprite => {
  const W = 320;
  const H = 70;
  const c = new PixelCanvas(W, H);
  const rand = mulberry32(7);
  let x = 0;
  while (x < W) {
    const w = 8 + Math.floor(rand() * 14);
    const h = 14 + Math.floor(rand() * 44);
    const top = H - h;
    const body = rand() > 0.5 ? "b" : "B";
    c.rect(x, top, w, h, body);
    c.hline(x, top, w, "e");
    if (rand() > 0.7) c.vline(x + Math.floor(w / 2), top - 6, 6, "e"); // antenna
    if (rand() > 0.85) c.set(x + Math.floor(w / 2), top - 7, "r"); // beacon
    for (let wy = top + 3; wy < H - 3; wy += 4) {
      for (let wx = x + 2; wx < x + w - 2; wx += 3) {
        const roll = rand();
        if (roll > 0.86) c.rect(wx, wy, 1, 2, roll > 0.97 ? "W" : roll > 0.92 ? "y" : "v");
      }
    }
    x += w + (rand() > 0.6 ? 1 : 0);
  }
  return c.toSprite({
    b: "#130b24",
    B: "#170e2b",
    e: "#241540",
    v: "#6a52b8",
    y: "#ffcf7a",
    W: "#fff1cc",
    r: "#ff6b8b",
  });
});

/* ── The STARBYTE cinema (final CTA) ──────────────────────────────────────── */

export const cinema = memo((): Sprite => {
  const W = 128;
  const H = 88;
  const c = new PixelCanvas(W, H);

  // Tower with the star on top.
  c.rect(50, 10, 28, 30, "f");
  c.rect(52, 12, 24, 26, "F");
  c.rect(58, 2, 12, 10, "f");
  c.stamp(["...s...", "..sSs..", "sSSSSSs", "..sSs..", "...s..."], 61, 0);
  for (let y = 16; y < 36; y += 6) {
    c.rect(56, y, 4, 3, "y");
    c.rect(68, y, 4, 3, "y");
  }

  // Main facade.
  c.rect(6, 36, 116, 52, "f");
  c.rect(6, 36, 116, 2, "e");
  for (const px of [6, 40, 84, 118]) c.rect(px, 38, 4, 50, "e"); // pilasters

  // Marquee with chasing bulbs (two phases: 1 and 2).
  c.rect(20, 40, 88, 18, "k");
  c.rect(22, 42, 84, 14, "K");
  let phase = 0;
  for (let bx = 20; bx < 108; bx += 3) {
    c.set(bx, 40, phase % 2 ? "1" : "2");
    c.set(bx, 57, phase % 2 ? "2" : "1");
    phase++;
  }
  for (let by = 43; by < 56; by += 3) {
    c.set(20, by, by % 2 ? "1" : "2");
    c.set(107, by, by % 2 ? "2" : "1");
  }

  // Posters.
  for (const px of [14, 94]) {
    c.rect(px, 62, 20, 22, "o");
    c.rect(px + 1, 63, 18, 20, "P");
    c.rect(px + 3, 66, 14, 9, px < 64 ? "q" : "Q");
    c.rect(px + 3, 77, 10, 1, "w");
    c.rect(px + 3, 79, 7, 1, "w");
  }

  // Glowing doors.
  c.rect(46, 62, 36, 26, "o");
  c.rect(48, 64, 15, 24, "L");
  c.rect(65, 64, 15, 24, "L");
  c.rect(48, 64, 15, 3, "l");
  c.rect(65, 64, 15, 3, "l");
  c.rect(61, 72, 1, 4, "o");
  c.rect(66, 72, 1, 4, "o");

  // Steps.
  c.rect(40, 86, 48, 2, "e");

  return c.toSprite({
    f: "#1a1030",
    F: "#21143c",
    e: "#2d1c52",
    k: "#0f0820",
    K: "#160d2c",
    o: "#0b0716",
    s: "#ffb84d",
    S: "#fff1cc",
    y: "#ffcf7a",
    "1": "#ffd27a",
    "2": "#ffd27a",
    P: "#2b1a4a",
    q: "#8b5cf6",
    Q: "#ff6b8b",
    w: "#a99bc4",
    L: "#ffcf8a",
    l: "#fff1cc",
  });
});

/* ── Stadium (live sports) ────────────────────────────────────────────────── */

export const stadium = memo((): Sprite => {
  const W = 240;
  const H = 96;
  const c = new PixelCanvas(W, H);
  const rand = mulberry32(42);

  // Stands: a stepped bowl.
  for (let y = 22; y < 62; y++) {
    const inset = Math.max(0, Math.floor((62 - y) * 0.9));
    for (let x = inset; x < W - inset; x++) {
      const tier = (y - 22) % 8 === 0;
      c.set(x, y, tier ? "t" : "s");
    }
  }
  c.hline(0, 62, W, "t");

  // Pitch with stripes and markings.
  for (let y = 63; y < H; y++) {
    for (let x = 0; x < W; x++) c.set(x, y, Math.floor(x / 20) % 2 ? "g" : "G");
  }
  c.hline(0, 66, W, "w");
  c.vline(W / 2, 66, H - 66, "w");
  c.disc(W / 2, 80, 10, (_x, _y, d) => (d > 9 ? "w" : null));

  // Floodlight towers.
  for (const tx of [14, W - 22]) {
    c.rect(tx + 3, 8, 2, 56, "p");
    c.rect(tx, 0, 8, 8, "o");
    c.rect(tx + 1, 1, 6, 6, "L");
  }

  // Scattered phone flashes in the crowd.
  for (let i = 0; i < 40; i++) {
    const y = 24 + Math.floor(rand() * 36);
    const inset = Math.max(0, Math.floor((62 - y) * 0.9));
    const x = inset + Math.floor(rand() * (W - inset * 2));
    if (c.get(x, y) === "s") c.set(x, y, rand() > 0.5 ? "F" : "f");
  }

  return c.toSprite({
    s: "#1c1230",
    t: "#2a1a47",
    g: "#123a34",
    G: "#14443b",
    w: "#7fb5a7",
    p: "#2a1a47",
    o: "#0b0716",
    L: "#fff6d8",
    f: "#d9c6ff",
    F: "#ffd27a",
  });
});

/** Crowd heads for the stands — a separate layer so it can bounce on a goal. */
export const crowd = memo((): Sprite => {
  const W = 240;
  const H = 40;
  const c = new PixelCanvas(W, H);
  const rand = mulberry32(99);
  const colors = ["a", "b", "c", "d", "e"];
  for (let row = 0; row < 5; row++) {
    const y = 4 + row * 8;
    const inset = Math.max(0, Math.floor((40 - y) * 0.9));
    for (let x = inset + 1; x < W - inset - 1; x += 3) {
      if (rand() > 0.82) continue;
      const col = colors[Math.floor(rand() * colors.length)]!;
      c.rect(x, y, 2, 2, "h");
      c.rect(x, y + 2, 2, 2, col);
      if (rand() > 0.9) c.set(x, y - 2, "y"); // raised scarf/flag
    }
  }
  return c.toSprite({
    h: "#d9b38c",
    a: "#8b5cf6",
    b: "#5b3a99",
    c: "#ff6b8b",
    d: "#3a3346",
    e: "#b784ff",
    y: "#ffb84d",
  });
});
