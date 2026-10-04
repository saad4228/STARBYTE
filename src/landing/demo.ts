import { useSyncExternalStore } from "react";
import { REACTIONS } from "../../shared/constants";
import { prefersReducedMotion } from "../lib/router";

/**
 * State for the fake room in the hero. The scene renders it; the HUD band below the hero
 * drives it (PLAY / REACT / MOMENT / CHAT), so the landing page behaves like a tiny game.
 */

export type BootPhase = "connecting" | "analyzing" | "syncing" | "synced";

export interface FloatItem {
  id: number;
  emoji: string;
  /** Horizontal position, percent. */
  x: number;
}

export interface DemoState {
  phase: BootPhase;
  booted: boolean;
  playing: boolean;
  time: number;
  syncMs: number;
  viewers: number;
  floats: FloatItem[];
  toast: { id: number; text: string } | null;
  chat: { id: number; name: string; text: string }[];
  moments: number;
}

export const DEMO_PEOPLE = [
  { name: "SAAD", seed: 1207 },
  { name: "ALI", seed: 5521 },
  { name: "AHMED", seed: 88 },
  { name: "ZAIN", seed: 3141 },
] as const;

const CHAT_LINES = [
  { name: "ALI", text: "broooo 😭" },
  { name: "SAAD", text: "this scene 💀" },
  { name: "ZAIN", text: "turn it up!!" },
  { name: "AHMED", text: "called it 🔥" },
  { name: "ALI", text: "wait rewind— no don't" },
];

const START_TIME = 5060; // 01:24:20

let state: DemoState = {
  phase: "connecting",
  booted: false,
  playing: true,
  time: START_TIME,
  syncMs: 18,
  viewers: 0,
  floats: [],
  toast: null,
  chat: [],
  moments: 0,
};

const listeners = new Set<() => void>();
let nextId = 1;
let timers: number[] = [];
let running = 0;
let chatIndex = 0;

function set(patch: Partial<DemoState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function later(fn: () => void, ms: number) {
  timers.push(window.setTimeout(fn, ms));
}

export function useDemo(): DemoState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

export const demo = {
  /** Called by the hero on mount. Reference-counted so StrictMode double-mounts are harmless. */
  start() {
    running++;
    if (running > 1) return;
    const reduced = prefersReducedMotion();
    if (reduced) {
      set({ phase: "synced", booted: true, viewers: DEMO_PEOPLE.length, playing: false });
    } else {
      set({ phase: "connecting", booted: false, viewers: 0 });
      later(() => set({ phase: "analyzing" }), 900);
      later(() => set({ phase: "syncing" }), 1800);
      later(() => set({ phase: "synced" }), 2700);
      later(() => set({ booted: true }), 3500);
      DEMO_PEOPLE.forEach((_, i) => later(() => set({ viewers: i + 1 }), 3600 + i * 180));
      later(() => demo.react("😂"), 4700);
    }

    timers.push(
      window.setInterval(() => {
        if (state.booted && state.playing) set({ time: state.time + 1 });
      }, 1000),
    );
    timers.push(
      window.setInterval(() => {
        if (state.booted) set({ syncMs: 12 + Math.round(Math.random() * 12) });
      }, 2400),
    );
    if (!reduced) {
      const ambient = () => {
        if (state.booted && state.playing && !document.hidden) {
          demo.react(REACTIONS[Math.floor(Math.random() * REACTIONS.length)]!);
        }
        later(ambient, 2600 + Math.random() * 2600);
      };
      later(ambient, 7000);
    }
  },

  stop() {
    running = Math.max(0, running - 1);
    if (running > 0) return;
    timers.forEach((t) => {
      clearTimeout(t);
      clearInterval(t);
    });
    timers = [];
  },

  toggle() {
    if (!state.booted) set({ booted: true, phase: "synced", viewers: DEMO_PEOPLE.length });
    set({ playing: !state.playing });
  },

  react(emoji?: string) {
    const pick = emoji ?? REACTIONS[Math.floor(Math.random() * REACTIONS.length)]!;
    const item = { id: nextId++, emoji: pick, x: 12 + Math.random() * 70 };
    set({ floats: [...state.floats.slice(-14), item] });
    later(() => set({ floats: state.floats.filter((f) => f.id !== item.id) }), 2900);
  },

  moment() {
    const id = nextId++;
    const h = Math.floor(state.time / 3600);
    const m = Math.floor((state.time % 3600) / 60);
    const s = state.time % 60;
    const stamp = [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
    set({ toast: { id, text: `🔥 MOMENT SAVED · ${stamp}` }, moments: state.moments + 1 });
    demo.react("🔥");
    later(() => {
      if (state.toast?.id === id) set({ toast: null });
    }, 2400);
  },

  chat() {
    const line = CHAT_LINES[chatIndex++ % CHAT_LINES.length]!;
    const item = { id: nextId++, ...line };
    set({ chat: [...state.chat.slice(-2), item] });
    later(() => set({ chat: state.chat.filter((c) => c.id !== item.id) }), 4200);
  },
};
