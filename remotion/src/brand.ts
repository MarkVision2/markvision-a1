// Brand tokens — applied from brand.config.json (brand-intake onboarding).
// Hormozi-style vertical Reels: yellow accent on black, bold grotesque.
// Single source of truth for colours used by captions and motion inserts.
export const BRAND = {
  bg: "#0A0A0A", // near-black background
  ink: "#0A0A0A", // dark plates
  text: "#FFFFFF", // primary caption / label text
  textDim: "#9A9AA2", // secondary / inactive text
  accent: "#FFD400", // yellow accent (accent words, key numbers, bars)
  accentInk: "#0A0A0A", // text drawn on top of the accent colour
  fontWeight: 800 as const,
} as const;
