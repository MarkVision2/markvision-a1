import React from "react";
import { AbsoluteFill, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Audio, Video } from "@remotion/media";
import { displayFontFamily } from "./fonts";
import { BRAND } from "./brand";
import { MOTION_TEMPLATES, SceneBackground } from "./motion";
import type { ShortWord } from "./Shorts916";

// ─────────────────────────────────────────────────────────────────────────────
// "Монтаж 50/50" — split-screen: speaker in one half, a second video (screen
// recording) in the other, captions on the seam. Meant for the KEY moments when
// the author demonstrates something on screen; outside those the normal
// full-frame edit (Shorts916) plays. This composition renders the split look.
//
// splits: time ranges (frames) when the screen half is shown. Outside them the
// speaker fills the frame. `screen` = base media name in public/ (the uploaded
// screen recording); null → a placeholder panel so the layout is previewable.
// `speaker` = "bottom" (default, author below) or "top".
// ─────────────────────────────────────────────────────────────────────────────

// A split moment shows the "screen" half as either the uploaded recording
// (screenFrom trim), or — when there is no recording — a Remotion motion scene
// from the library (template + data), so everything is animated in Remotion.
export type SplitEvent = {
  from: number;
  to: number;
  screenFrom?: number;
  template?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: Record<string, any>;
};

export type SplitProps = {
  src: string;
  previewSrc: string | null;
  fps: number;
  speakerStartFrame: number;
  words: ShortWord[];
  audioTrack: string | null;
  screen: string | null;
  speaker: "top" | "bottom";
  splits: SplitEvent[];
  totalDurationInFrames: number;
  music?: string | null;
  musicVolume?: number;
  voiceBoost?: number;
};

const CANVAS_H = 1920;
const HALF = CANVAS_H / 2;
const PAPER = BRAND.text;
const SCARLET = BRAND.accent;

const ScreenPlaceholder: React.FC = () => (
  <AbsoluteFill style={{ background: "radial-gradient(120% 90% at 30% 20%, #16233E 0%, #0A0C14 60%)", alignItems: "center", justifyContent: "center", fontFamily: displayFontFamily }}>
    <div style={{ width: "82%", height: "72%", borderRadius: 22, background: "#0F131C", border: `1px solid ${BRAND.glassBorder}`, boxShadow: BRAND.glassShadow, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 20px", borderBottom: `1px solid ${BRAND.glassBorder}` }}>
        {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => <div key={c} style={{ width: 16, height: 16, borderRadius: "50%", background: c }} />)}
        <span style={{ marginLeft: 8, fontSize: 24, color: BRAND.textDim, fontFamily: "ui-monospace,monospace" }}>screen.rec</span>
      </div>
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
        {[0.9, 0.6, 0.75, 0.4].map((w, i) => <div key={i} style={{ height: 26, width: `${w * 100}%`, borderRadius: 8, background: "rgba(255,255,255,0.07)" }} />)}
      </div>
    </div>
    <div style={{ position: "absolute", bottom: 24, fontSize: 26, fontWeight: 800, letterSpacing: "0.12em", color: BRAND.textDim, textTransform: "uppercase" }}>Запись экрана</div>
  </AbsoluteFill>
);

const SpeakerPane: React.FC<{ src: string; startFrame: number; audioMuted: boolean; voiceBoost: number }> = ({ src, startFrame, audioMuted, voiceBoost }) => (
  // full 9:16 speaker cropped into a half-height pane, biased to the face (top)
  <AbsoluteFill style={{ overflow: "hidden" }}>
    <Video
      src={staticFile(src)}
      trimBefore={startFrame}
      muted={audioMuted}
      volume={voiceBoost}
      objectFit="cover"
      style={{ width: "100%", height: "100%", objectPosition: "50% 38%" }}
    />
  </AbsoluteFill>
);

const Screen: React.FC<{ screen: string | null; event: SplitEvent | null; localFrame: number }> = ({ screen, event, localFrame }) => {
  // 1) real screen recording, if uploaded
  if (screen) {
    return (
      <AbsoluteFill style={{ overflow: "hidden", background: "#0A0C14" }}>
        <Video src={staticFile(screen)} trimBefore={event?.screenFrom ?? 0} muted objectFit="cover" style={{ width: "100%", height: "100%" }} />
      </AbsoluteFill>
    );
  }
  // 2) Remotion motion scene from the library (everything animated in Remotion)
  if (event?.template && MOTION_TEMPLATES[event.template]) {
    const Comp = MOTION_TEMPLATES[event.template];
    const floatY = Math.sin(localFrame / 28) * 7; // gentle continuous breathe
    return (
      <AbsoluteFill style={{ overflow: "hidden" }}>
        <SceneBackground localFrame={localFrame} accent={event.data?.accent} />
        <AbsoluteFill style={{ transform: `translateY(${floatY}px)` }}>
          <Comp localFrame={localFrame} duration={event.to - event.from} {...(event.data ?? {})} />
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }
  // 3) fallback placeholder
  return <ScreenPlaceholder />;
};

// Captions live in the LOWER part of the speaker's half (clear of the face,
// which sits near the seam), like normal Reels — never centred on the face.
const Captions: React.FC<{ words: ShortWord[]; speakerBottom: boolean }> = ({ words, speakerBottom }) => {
  const frame = useCurrentFrame();
  let ci = -1;
  for (let i = 0; i < words.length; i++) {
    if (words[i].from <= frame) ci = i;
    else break;
  }
  if (ci < 0) return null;
  const start = Math.floor(ci / 3) * 3;
  const chunk = words.slice(start, ci + 1);
  // Reels safe zone: keep text out of the bottom ~320px (UI) — sit in the
  // "место для текста" band above it. Speaker top → just above centre.
  const bottomPad = speakerBottom ? 360 : 1090;
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", padding: `0 44px ${bottomPad}px` }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "0.24em", maxWidth: "94%", fontFamily: displayFontFamily, fontWeight: 800, fontSize: 62, lineHeight: 1.0, textTransform: "uppercase", textAlign: "center" }}>
        {chunk.map((w, k) => {
          const cur = start + k === ci;
          return (
            <span key={start + k} style={{ color: w.accent || cur ? BRAND.accentInk : PAPER, background: w.accent || cur ? SCARLET : "transparent", padding: w.accent || cur ? "0 0.12em" : 0, borderRadius: 8, textShadow: w.accent || cur ? "none" : "0 4px 20px rgba(0,0,0,0.9)" }}>{w.text}</span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export const Split5050: React.FC<SplitProps> = ({ src, previewSrc, speakerStartFrame, words, audioTrack, screen, speaker, splits, music = null, musicVolume = 0.09, voiceBoost = 3.2 }) => {
  const frame = useCurrentFrame();
  const active = splits.find((s) => frame >= s.from && frame < s.to) ?? null;
  // 0..1 how open the split is (slide the screen half in/out)
  const amt = active
    ? interpolate(frame, [active.from, active.from + 10, active.to - 10, active.to], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : 0;
  const speakerBottom = speaker === "bottom";
  const seamY = HALF;
  const src0 = previewSrc ?? src;

  return (
    <AbsoluteFill style={{ backgroundColor: "#0A0C14" }}>
      {/* Speaker: full-frame when closed, shifts into its half as the split opens */}
      <AbsoluteFill style={{ top: 0, height: CANVAS_H }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: speakerBottom ? amt * HALF : 0, height: CANVAS_H - amt * HALF, overflow: "hidden" }}>
          <SpeakerPane src={src0} startFrame={speakerStartFrame} audioMuted={audioTrack != null} voiceBoost={voiceBoost} />
        </div>
      </AbsoluteFill>

      {/* Screen half slides in from the edge */}
      {amt > 0 ? (
        <div style={{ position: "absolute", left: 0, right: 0, height: HALF, top: speakerBottom ? -(1 - amt) * HALF : CANVAS_H - amt * HALF, overflow: "hidden", boxShadow: "0 0 40px rgba(0,0,0,0.6)" }}>
          <Screen screen={screen} event={active} localFrame={active ? frame - active.from : 0} />
        </div>
      ) : null}

      {/* accent seam line */}
      {amt > 0.3 ? <div style={{ position: "absolute", left: 0, right: 0, top: seamY - 3, height: 6, background: SCARLET, opacity: amt, boxShadow: `0 0 20px ${SCARLET}` }} /> : null}

      <Captions words={words} speakerBottom={speakerBottom} />

      {audioTrack ? <Audio src={staticFile(audioTrack)} /> : null}
      {music ? <Audio src={staticFile(music)} volume={musicVolume} /> : null}
    </AbsoluteFill>
  );
};
