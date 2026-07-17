// Brand tokens — premium dark "AI content factory" look (refs A/B/C).
// Overlays sit ON TOP of the speaker video: dark glass panels + a vivid accent,
// no full-screen black plates, no speaker shift.
export const BRAND = {
  bg: "#0A0C14", // deep near-black (used only for optional intro/outro)
  text: "#FFFFFF", // primary text
  textDim: "#AEB4C2", // secondary text
  accent: "#FF7A18", // vivid orange accent (numbers, key words, glows)
  accentSoft: "#FFB068", // lighter accent for gradients
  accentInk: "#0A0C14", // text on top of the accent colour
  // Glassmorphism panel over live footage.
  glassBg: "rgba(12, 14, 22, 0.72)",
  glassBorder: "rgba(255, 255, 255, 0.14)",
  glassShadow: "0 24px 60px rgba(0,0,0,0.55)",
  fontWeight: 800 as const,
} as const;
