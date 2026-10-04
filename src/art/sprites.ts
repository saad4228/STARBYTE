import { mulberry32, sprite, type Sprite } from "./engine";

/* ─────────────────────────────────────────────────────────────────────────────
 * BYTE — STARBYTE's mascot. A small cinema creature: two film-reel ears, a
 * signal-star antenna, big eyes. Original art; 21 × 20.
 * ──────────────────────────────────────────────────────────────────────────── */

const BYTE_PALETTE = {
  o: "#1b0f33", // outline
  R: "#5b3a99", // reel
  r: "#24123d", // reel holes
  h: "#efe4ff", // highlight
  l: "#b784ff", // light
  p: "#8b5cf6", // body
  d: "#6c45d9", // shade
  D: "#4a2a9a", // deep shade
  w: "#f5f1ff", // eye white
  k: "#0b0716", // pupil / mouth
  c: "#ff9ad5", // cheeks
  s: "#ffb84d", // star
  S: "#fff1cc", // star core
};

const BYTE_FRONT = [
  "...ooo....s....ooo...",
  "..oRRRo..sSs..oRRRo..",
  ".oRrRrRo..s..oRrRrRo.",
  ".oRRoRRo..o..oRRoRRo.",
  ".oRrRrRo..o..oRrRrRo.",
  "..oRRRoooooooooRRRo..",
  "..oooohhllllllpoooo..",
  ".ohhlllllppppppppddo.",
  ".ohlllppppppppppppdo.",
  ".ollppwkpppppwkpppdo.",
  ".olpppkkpppppkkppddo.",
  ".olpppkkpppppkkppddo.",
  ".oppppkkpppppkkppddo.",
  ".opccppppkpkppppccdo.",
  ".oppppppppkppppppddo.",
  ".odppppppppppppppdDo.",
  "..oddpppppppppddDDo..",
  "...ooooooooooooooo...",
  ".....oDDo...oDDo.....",
  ".....oooo...oooo.....",
];

/** Eyes shut: the same face with lids drawn. Layered over BYTE_FRONT for blinking. */
const BYTE_BLINK = BYTE_FRONT.map((row, y) => {
  if (y < 9 || y > 12) return row.replace(/./g, ".");
  const chars = row.split("").map(() => ".");
  for (const x of [6, 7, 13, 14]) chars[x] = y === 11 ? "k" : "p";
  return chars.join("");
});

/** Back view, for walking into the theatre. */
const BYTE_BACK = BYTE_FRONT.map((row, y) =>
  y >= 9 && y <= 14 ? row.replace(/[wkc]/g, (_, i: number) => (i > 15 ? "d" : "p")) : row,
);

export const byteFront = sprite(BYTE_FRONT, BYTE_PALETTE);
export const byteBlink = sprite(BYTE_BLINK, BYTE_PALETTE);
export const byteBack = sprite(BYTE_BACK, BYTE_PALETTE);

/* Accessories are drawn on their own small grids and positioned around BYTE. */

export const remote = sprite(
  [
    ".oooo.",
    "okkkko",
    "okSsko",
    "okkkko",
    "oklRko",
    "okkkko",
    "oklkko",
    "opppo.",
    "oppppo",
    ".oooo.",
  ],
  { ...BYTE_PALETTE, R: "#ff6b8b" },
);

export const laptop = sprite(
  [
    "..oooooooooooo..",
    "..ohhhhhhhhhho..",
    "..ohllllllllho..",
    "..ohlpplllllho..",
    "..ohllllppllho..",
    "..ohhhhhhhhhho..",
    "..oooooooooooo..",
    "oooooooooooooooo",
    "oRRRRRRRRRRRRRRo",
    ".oooooooooooooo.",
  ],
  BYTE_PALETTE,
);

/** Team scarf, aligned to BYTE's own grid (rows 13–17 of the body). */
export const scarf = sprite(
  [
    ".....................",
    ".oooooooooooooooooo..",
    ".oaaWWaaWWaaWWaaWWao.",
    ".oaaWWaaWWaaWWaaWWao.",
    "..ooooooooooooooooo..",
    "...........oWWo......",
    "...........oaao......",
    "...........oWWo......",
    "...........oooo......",
  ],
  { ...BYTE_PALETTE, a: "#ffb84d", W: "#f5f1ff" },
);

export const popcorn = sprite(
  [
    "..hh.h..",
    ".hhhhhh.",
    "hhShhhhh",
    "oooooooo",
    "oWlWlWlo",
    "oWlWlWlo",
    ".oWlWlo.",
    ".oWlWlo.",
    "..oooo..",
  ],
  { ...BYTE_PALETTE, h: "#fff1cc", S: "#ffb84d", W: "#f5f1ff" },
);

/* ─────────────────────────────────────────────────────────────────────────────
 * Audience — friends seen from behind, rim-lit by the screen. 13 × 13.
 * H hair, h rim light, S skin, C clothes, c clothes shade, o outline.
 * ──────────────────────────────────────────────────────────────────────────── */

const VIEWER_SHAPES: readonly (readonly string[])[] = [
  // short hair
  [
    "....hhhhh....",
    "...hHHHHHh...",
    "..hHHHHHHHh..",
    "..oHHHHHHHo..",
    "..oHHHHHHHo..",
    "...oHHHHHo...",
    "....oSSSo....",
    "..ohCCCCCho..",
    ".ohCCCCCCCho.",
    ".oCCCCCCCCCo.",
    "oCCCCCCCCCCCo",
    "oCCCCCCCCCCCo",
    "oCCCCCCCCCCCo",
  ],
  // long hair
  [
    "....hhhhh....",
    "...hHHHHHh...",
    "..hHHHHHHHh..",
    "..oHHHHHHHo..",
    "..oHHHHHHHo..",
    "..oHHHHHHHo..",
    "..oHHHHHHHo..",
    "..ohHHHHHho..",
    ".ohCHHHHHCho.",
    ".oCCCHHHCCCo.",
    "oCCCCCCCCCCCo",
    "oCCCCCCCCCCCo",
    "oCCCCCCCCCCCo",
  ],
  // bun
  [
    ".....hhh.....",
    "....hHHHh....",
    "....hhhhh....",
    "...hHHHHHh...",
    "..oHHHHHHHo..",
    "..oHHHHHHHo..",
    "...oHHHHHo...",
    "....oSSSo....",
    "..ohCCCCCho..",
    ".ohCCCCCCCho.",
    "oCCCCCCCCCCCo",
    "oCCCCCCCCCCCo",
    "oCCCCCCCCCCCo",
  ],
  // beanie
  [
    "......h......",
    "....hhhhh....",
    "...hBBBBBh...",
    "..hBBBBBBBh..",
    "..obbbbbbbo..",
    "..oHHHHHHHo..",
    "...oHHHHHo...",
    "....oSSSo....",
    "..ohCCCCCho..",
    ".ohCCCCCCCho.",
    "oCCCCCCCCCCCo",
    "oCCCCCCCCCCCo",
    "oCCCCCCCCCCCo",
  ],
];

const HAIR = ["#2a1d24", "#3b2a20", "#120e1a", "#6b3f2a", "#d9a35b", "#7c5cff", "#b8475d", "#e7d3b0"];
const SKIN = ["#f1c8a6", "#d9a07a", "#b9785a", "#8c5a40", "#5e3b2a", "#f6dccb"];
const CLOTHES = ["#4b2b8f", "#2c3e66", "#6b2b56", "#2e4d47", "#3a3346", "#7a3e2a", "#5b3a99"];

export interface ViewerLook {
  shape: number;
  hair: string;
  skin: string;
  clothes: string;
}

export function viewerLook(seed: number): ViewerLook {
  const rand = mulberry32(seed);
  const pick = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length)]!;
  return {
    shape: Math.floor(rand() * VIEWER_SHAPES.length),
    hair: pick(HAIR),
    skin: pick(SKIN),
    clothes: pick(CLOTHES),
  };
}

const viewerCache = new Map<string, Sprite>();

export function viewerSprite(look: ViewerLook): Sprite {
  const key = `${look.shape}|${look.hair}|${look.skin}|${look.clothes}`;
  let s = viewerCache.get(key);
  if (!s) {
    s = sprite(VIEWER_SHAPES[look.shape % VIEWER_SHAPES.length]!, {
      o: "#0d0818",
      h: "#6f5aa8",
      H: look.hair,
      S: look.skin,
      C: look.clothes,
      c: "#0d0818",
      B: look.clothes,
      b: "#f5f1ff",
    });
    viewerCache.set(key, s);
  }
  return s;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Avatars — front-facing pixel portraits generated from a seed. 12 × 12.
 * ──────────────────────────────────────────────────────────────────────────── */

const AVATAR_HAIR: readonly (readonly string[])[] = [
  // tidy
  ["...HHHHHH...", "..HHHHHHHH..", ".HHHHHHHHHH.", ".HHSSSSSSHH.", ".HSSSSSSSSH."],
  // fringe
  ["...HHHHHH...", "..HHHHHHHH..", ".HHHHHHHHHH.", ".HHHHHHSSSH.", ".HSSSSSSSSH."],
  // spiky
  ["..H.HH.H.H..", "..HHHHHHHH..", ".HHHHHHHHHH.", ".HSSHSSHSSH.", ".HSSSSSSSSH."],
  // cap
  ["...CCCCCC...", "..CCCCCCCC..", ".CCCCCCCCCCC", ".HSSSSSSSSH.", ".HSSSSSSSSH."],
];

const AVATAR_FACE = [
  ".SSwkSSwkSS.",
  ".SSSSSSSSSS.",
  ".SmSSSSSSmS.",
  "..SSSkkSSS..",
  "...SSSSSS...",
  "..CCCCCCCC..",
  ".CCCCCCCCCC.",
];

const avatarCache = new Map<number, Sprite>();

/** Deterministic pixel portrait for a participant. */
export function avatarSprite(seed: number): Sprite {
  const cached = avatarCache.get(seed);
  if (cached) return cached;
  const rand = mulberry32(seed || 1);
  const pick = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length)]!;
  const hairRows = pick(AVATAR_HAIR);
  const s = sprite([...hairRows, ...AVATAR_FACE], {
    H: pick(HAIR),
    S: pick(SKIN),
    C: pick(CLOTHES.concat(["#8b5cf6", "#ffb84d"])),
    w: "#f5f1ff",
    k: "#0b0716",
    m: "#ff9ad5",
  });
  avatarCache.set(seed, s);
  return s;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Props
 * ──────────────────────────────────────────────────────────────────────────── */

export const projector = sprite(
  [
    "........ooooo.....ooooo...",
    ".......oRRRRRo...oRRRRRo..",
    "......oRrRRRrRo.oRrRRRrRo.",
    "......oRRRoRRRo.oRRRoRRRo.",
    "......oRrRRRrRo.oRrRRRrRo.",
    ".......oRRRRRo...oRRRRRo..",
    "........ooooo.....ooooo...",
    ".........o..o.....o..o....",
    "....oooooooooooooooooooo..",
    "oooooBBBBBBBBBBBBBBBBBBo..",
    "oLLLoBllBBBBBBBBBBvBvBBo..",
    "oLWLoBllBBBBBBBBBBvBvBBo..",
    "oLLLoBBBBBBBBBBBBBBBBBBo..",
    "ooooobbbbbbbbbbbbbbbbbbo..",
    "....oooooooooooooooooooo..",
    ".......oo..........oo.....",
    "......oooo........oooo....",
  ],
  {
    o: "#120a22",
    R: "#5b3a99",
    r: "#1a0d2e",
    B: "#3a2866",
    b: "#2b1d4d",
    l: "#6d4cb8",
    v: "#120a22",
    L: "#dccbff",
    W: "#ffffff",
  },
);

export const sparkle = sprite(
  ["...w...", "...w...", "..wWw..", "wwWWWww", "..wWw..", "...w...", "...w..."],
  { w: "#b784ff", W: "#f5f1ff" },
);

export const sparkleSmall = sprite([".w.", "wWw", ".w."], { w: "#b784ff", W: "#f5f1ff" });

export const heart = sprite(
  [".oo.oo.", "ohhoppo", "ohppppo", "opppppo", ".opppo.", "..opo..", "...o..."],
  { o: "#1b0f33", p: "#8b5cf6", h: "#dccbff" },
);

/* ─────────────────────────────────────────────────────────────────────────────
 * Pixel icons, 12 × 12, single accent color + white.
 * ──────────────────────────────────────────────────────────────────────────── */

const ICON_PALETTE = { a: "#b784ff", A: "#8b5cf6", w: "#f5f1ff", d: "#24123d", y: "#ffb84d" };

export const icons = {
  local: sprite(
    [
      "............",
      ".aaaaaaaaaa.",
      ".awwwwwwwwa.",
      ".awAAwwwwwa.",
      ".awwwwAAwwa.",
      ".awwwwwwwwa.",
      ".aaaaaaaaaa.",
      "............",
      "aaaaaaaaaaaa",
      "AAAAAAAAAAAA",
      ".AAAAAAAAAA.",
      "............",
    ],
    ICON_PALETTE,
  ),
  cloud: sprite(
    [
      "............",
      "............",
      "....aaaa....",
      "...awwwwa...",
      "..awwwwwwa..",
      ".aawwwwwwaa.",
      "awwwwwwwwwwa",
      "awwwwwwwwwwa",
      "awwwwwwwwwwa",
      ".aaaaaaaaaa.",
      "............",
      "............",
    ],
    ICON_PALETTE,
  ),
  stream: sprite(
    [
      "............",
      "......aaaa..",
      ".....awwwwa.",
      "....awa..wa.",
      "....aw..awa.",
      "...a...awa..",
      "..awa...a...",
      ".awa..wa....",
      ".aw..awa....",
      ".awwwwa.....",
      "..aaaa......",
      "............",
    ],
    ICON_PALETTE,
  ),
  play: sprite(
    [
      "............",
      "..aa........",
      "..awaa......",
      "..awwwaa....",
      "..awwwwwaa..",
      "..awwwwwwwa.",
      "..awwwwwwwa.",
      "..awwwwwaa..",
      "..awwwaa....",
      "..awaa......",
      "..aa........",
      "............",
    ],
    ICON_PALETTE,
  ),
  chat: sprite(
    [
      "............",
      ".aaaaaaaaaa.",
      "awwwwwwwwwwa",
      "awAAwAAwAAwa",
      "awwwwwwwwwwa",
      "awwwwwwwwwwa",
      ".aaawwaaaaa.",
      "...awa......",
      "...aa.......",
      "............",
      "............",
      "............",
    ],
    ICON_PALETTE,
  ),
  lock: sprite(
    [
      "....aaaa....",
      "...a....a...",
      "..a......a..",
      "..a......a..",
      ".aaaaaaaaaa.",
      ".awwwwwwwwa.",
      ".awwwAAwwwa.",
      ".awwwAAwwwa.",
      ".awwwwAwwwa.",
      ".awwwwwwwwa.",
      ".aaaaaaaaaa.",
      "............",
    ],
    ICON_PALETTE,
  ),
  spark: sprite(
    [
      ".....a......",
      ".....a......",
      ".....a......",
      "....awa.....",
      "...awwwa....",
      "aaawwwwwaaa.",
      "...awwwa....",
      "....awa.....",
      ".....a......",
      ".....a......",
      ".....a......",
      "............",
    ],
    ICON_PALETTE,
  ),
  mic: sprite(
    [
      "....aaaa....",
      "...awwwwa...",
      "...awwwwa...",
      "...awwwwa...",
      ".a.awwwwa.a.",
      ".a.awwwwa.a.",
      ".a..aaaa..a.",
      "..a......a..",
      "...aaaaaa...",
      ".....aa.....",
      "...aaaaaa...",
      "............",
    ],
    ICON_PALETTE,
  ),
  ball: sprite(
    [
      "....aaaa....",
      "..aawwwwaa..",
      ".awwwddwwwa.",
      ".awwddddwwa.",
      "awwwwddwwwwa",
      "awdwwwwwwdwa",
      "awddwwwwddwa",
      "awdwwwwwwdwa",
      ".awwwddwwwa.",
      ".awwddddwwa.",
      "..aawwwwaa..",
      "....aaaa....",
    ],
    ICON_PALETTE,
  ),
  users: sprite(
    [
      "............",
      "...aa...aa..",
      "..awwa.awwa.",
      "..awwa.awwa.",
      "...aa...aa..",
      "............",
      "..aaaa.aaaa.",
      ".awwwwawwwwa",
      ".awwwwawwwwa",
      ".aaaaaaaaaaa",
      "............",
      "............",
    ],
    ICON_PALETTE,
  ),
} as const;

export type PixelIconName = keyof typeof icons;
