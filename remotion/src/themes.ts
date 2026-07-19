// Visual themes for faceless Reels — each video picks one so the feed doesn't
// look like one endless clone of the same dark-orange backdrop.
export type ReelsThemeId =
  | "midnight-orange"
  | "neon-violet"
  | "ocean-cyan"
  | "ember-red"
  | "mint-fresh"
  | "gold-noir"
  | "paper-ink"
  | "aurora-green";

export type ReelsTheme = {
  id: ReelsThemeId;
  label: string;
  bg: string;           // AbsoluteFill base
  bgLayers: string[];   // stacked CSS backgrounds for SceneBackground
  text: string;
  textDim: string;
  accent: string;       // default accent if scene doesn't override
  accentInk: string;    // text on accent pills
  glassBg: string;
  glassBorder: string;
  grid: string;         // grid line colour
  particle: "dots" | "sparks" | "none";
  sweep: boolean;
  rings: boolean;
};

export const REELS_THEMES: Record<ReelsThemeId, ReelsTheme> = {
  "midnight-orange": {
    id: "midnight-orange",
    label: "Midnight Orange",
    bg: "#0A0C14",
    bgLayers: [
      "radial-gradient(120% 85% at 22% 14%, #142544 0%, #0A0C14 55%)",
      "radial-gradient(100% 70% at 82% 92%, #10182B 0%, rgba(10,12,20,0) 60%)",
    ],
    text: "#FFFFFF",
    textDim: "#AEB4C2",
    accent: "#FF7A18",
    accentInk: "#0A0C14",
    glassBg: "rgba(12, 14, 22, 0.72)",
    glassBorder: "rgba(255, 255, 255, 0.14)",
    grid: "rgba(255,255,255,0.06)",
    particle: "dots",
    sweep: true,
    rings: true,
  },
  "neon-violet": {
    id: "neon-violet",
    label: "Neon Violet",
    bg: "#0B0618",
    bgLayers: [
      "radial-gradient(110% 80% at 18% 10%, #3B1D6E 0%, #0B0618 55%)",
      "radial-gradient(90% 70% at 88% 88%, #1A0B3A 0%, transparent 60%)",
      "linear-gradient(160deg, rgba(168,85,247,0.12), transparent 50%)",
    ],
    text: "#F5F3FF",
    textDim: "#C4B5FD",
    accent: "#A855F7",
    accentInk: "#0B0618",
    glassBg: "rgba(30, 10, 60, 0.7)",
    glassBorder: "rgba(168, 85, 247, 0.35)",
    grid: "rgba(168,85,247,0.12)",
    particle: "sparks",
    sweep: true,
    rings: true,
  },
  "ocean-cyan": {
    id: "ocean-cyan",
    label: "Ocean Cyan",
    bg: "#02121A",
    bgLayers: [
      "radial-gradient(120% 90% at 20% 0%, #0A3A4A 0%, #02121A 55%)",
      "radial-gradient(90% 70% at 90% 100%, #053040 0%, transparent 55%)",
      "linear-gradient(200deg, rgba(34,211,238,0.1), transparent 45%)",
    ],
    text: "#ECFEFF",
    textDim: "#A5F3FC",
    accent: "#22D3EE",
    accentInk: "#02121A",
    glassBg: "rgba(2, 30, 40, 0.7)",
    glassBorder: "rgba(34, 211, 238, 0.3)",
    grid: "rgba(34,211,238,0.1)",
    particle: "dots",
    sweep: true,
    rings: false,
  },
  "ember-red": {
    id: "ember-red",
    label: "Ember Red",
    bg: "#12060A",
    bgLayers: [
      "radial-gradient(110% 80% at 30% 8%, #4A1018 0%, #12060A 55%)",
      "radial-gradient(80% 60% at 80% 90%, #2A080E 0%, transparent 55%)",
      "linear-gradient(150deg, rgba(239,68,68,0.14), transparent 50%)",
    ],
    text: "#FFF5F5",
    textDim: "#FECACA",
    accent: "#EF4444",
    accentInk: "#12060A",
    glassBg: "rgba(30, 8, 12, 0.72)",
    glassBorder: "rgba(239, 68, 68, 0.32)",
    grid: "rgba(239,68,68,0.1)",
    particle: "sparks",
    sweep: true,
    rings: true,
  },
  "mint-fresh": {
    id: "mint-fresh",
    label: "Mint Fresh",
    bg: "#041410",
    bgLayers: [
      "radial-gradient(120% 85% at 15% 10%, #0C3A2E 0%, #041410 55%)",
      "radial-gradient(90% 70% at 85% 90%, #0A2A20 0%, transparent 55%)",
      "linear-gradient(180deg, rgba(52,211,153,0.1), transparent 50%)",
    ],
    text: "#ECFDF5",
    textDim: "#A7F3D0",
    accent: "#34D399",
    accentInk: "#041410",
    glassBg: "rgba(4, 30, 22, 0.7)",
    glassBorder: "rgba(52, 211, 153, 0.3)",
    grid: "rgba(52,211,153,0.1)",
    particle: "dots",
    sweep: false,
    rings: true,
  },
  "gold-noir": {
    id: "gold-noir",
    label: "Gold Noir",
    bg: "#0C0A06",
    bgLayers: [
      "radial-gradient(110% 80% at 25% 5%, #2A220E 0%, #0C0A06 55%)",
      "radial-gradient(80% 60% at 80% 95%, #1A1508 0%, transparent 55%)",
      "linear-gradient(140deg, rgba(251,191,36,0.12), transparent 50%)",
    ],
    text: "#FFFBEB",
    textDim: "#FDE68A",
    accent: "#FBBF24",
    accentInk: "#0C0A06",
    glassBg: "rgba(20, 16, 6, 0.75)",
    glassBorder: "rgba(251, 191, 36, 0.3)",
    grid: "rgba(251,191,36,0.08)",
    particle: "sparks",
    sweep: true,
    rings: false,
  },
  "paper-ink": {
    id: "paper-ink",
    label: "Paper Ink",
    bg: "#F4EFE6",
    bgLayers: [
      "radial-gradient(120% 90% at 20% 0%, #FFFDF8 0%, #F4EFE6 55%)",
      "radial-gradient(90% 70% at 90% 100%, #E8DFD0 0%, transparent 55%)",
      "linear-gradient(180deg, rgba(15,23,42,0.03), transparent 40%)",
    ],
    text: "#0F172A",
    textDim: "#475569",
    accent: "#0F172A",
    accentInk: "#F4EFE6",
    glassBg: "rgba(255, 255, 255, 0.78)",
    glassBorder: "rgba(15, 23, 42, 0.12)",
    grid: "rgba(15,23,42,0.06)",
    particle: "none",
    sweep: false,
    rings: false,
  },
  "aurora-green": {
    id: "aurora-green",
    label: "Aurora",
    bg: "#050814",
    bgLayers: [
      "radial-gradient(100% 80% at 10% 20%, #12304A 0%, #050814 50%)",
      "radial-gradient(90% 70% at 90% 10%, #1A3A2A 0%, transparent 55%)",
      "radial-gradient(80% 60% at 50% 100%, #2A1450 0%, transparent 55%)",
      "linear-gradient(120deg, rgba(52,211,153,0.08), rgba(168,85,247,0.08))",
    ],
    text: "#F8FAFC",
    textDim: "#CBD5E1",
    accent: "#34D399",
    accentInk: "#050814",
    glassBg: "rgba(8, 12, 28, 0.7)",
    glassBorder: "rgba(148, 163, 184, 0.25)",
    grid: "rgba(148,163,184,0.08)",
    particle: "dots",
    sweep: true,
    rings: true,
  },
};

export const REELS_THEME_IDS = Object.keys(REELS_THEMES) as ReelsThemeId[];

/** Stable pick from job id / seed so re-renders of the same job keep the look. */
export function pickTheme(seed: string | null | undefined): ReelsTheme {
  const s = seed || "default";
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const id = REELS_THEME_IDS[h % REELS_THEME_IDS.length];
  return REELS_THEMES[id];
}

export function resolveTheme(id: string | null | undefined, seed?: string): ReelsTheme {
  if (id && id in REELS_THEMES) return REELS_THEMES[id as ReelsThemeId];
  return pickTheme(seed);
}
