import React from "react";
import { AbsoluteFill, Img, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { Audio, Video } from "@remotion/media";
import { displayFontFamily } from "./fonts";
import { MOTION_TEMPLATES, SceneBackground } from "./motion";
import { resolveTheme, type ReelsTheme, type ReelsThemeId } from "./themes";
import type { ShortWord } from "./Shorts916";

// ─────────────────────────────────────────────────────────────────────────────
// "Reels-видео" — faceless графический ролик под сгенерённую озвучку. Лица нет:
// весь кадр — живой фон (SceneBackground) + слой частиц + непрерывная лента
// моушн-сцен из библиотеки (по смыслу фразы) + караоке-титры и индикатор сцен.
// Тема (theme) выбирается на каждый ролик — иначе вся лента выглядит одинаково.
// ─────────────────────────────────────────────────────────────────────────────

export type ReelsScene = {
  from: number;
  to: number;
  template: string;
  /** Full-bleed B-roll cutaway from library/Pexels/Kie (under motion chrome). */
  type?: "motion" | "video";
  file?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: Record<string, any>;
};

export type ReelsExplainerProps = {
  audioTrack: string;
  words: ShortWord[];
  scenes: ReelsScene[];
  totalDurationInFrames: number;
  fps: number;
  music?: string | null;
  musicVolume?: number;
  captions?: boolean;
  /** Visual theme id — see remotion/src/themes.ts. Falls back to seed/jobId. */
  theme?: ReelsThemeId | string | null;
  /** Stable seed (job id) when theme is omitted. */
  themeSeed?: string | null;
};

const TEXT_TEMPLATES = new Set(["big-statement", "kinetic-type", "quote-card", "lower-third"]);
const CANVAS_W = 1080;
const CANVAS_H = 1920;

const rnd = (i: number, s = 1) => {
  const x = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

const Particles: React.FC<{ frame: number; accent: string; mode: ReelsTheme["particle"] }> = ({
  frame, accent, mode,
}) => {
  if (mode === "none") return null;
  const N = mode === "sparks" ? 36 : 50;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {Array.from({ length: N }, (_, i) => {
        const x = rnd(i, 1) * CANVAS_W;
        const speed = 0.25 + rnd(i, 2) * 0.9;
        const y = (CANVAS_H + 40 - ((frame * speed + rnd(i, 3) * CANVAS_H) % (CANVAS_H + 80)));
        const size = mode === "sparks" ? 2 + Math.floor(rnd(i, 4) * 4) : 3 + Math.floor(rnd(i, 4) * 6);
        const tw = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(frame / (8 + rnd(i, 5) * 20) + i));
        const white = rnd(i, 6) > 0.55;
        const sway = Math.sin(frame / (30 + rnd(i, 7) * 40) + i) * 16;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x + sway,
              top: y,
              width: size,
              height: mode === "sparks" ? size * 2.4 : size,
              borderRadius: mode === "sparks" ? 2 : "50%",
              background: white ? "rgba(255,255,255,0.9)" : accent,
              opacity: tw,
              boxShadow: white ? "0 0 8px rgba(255,255,255,0.5)" : `0 0 10px ${accent}`,
              transform: mode === "sparks" ? `rotate(${rnd(i, 8) * 40 - 20}deg)` : undefined,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

const Captions: React.FC<{ words: ShortWord[]; scene: ReelsScene | null; theme: ReelsTheme }> = ({
  words, scene, theme,
}) => {
  const frame = useCurrentFrame();
  if (!scene) return null;
  if (scene.data?.caption === false || TEXT_TEMPLATES.has(scene.template)) return null;
  const sceneAccent = scene.data?.accent ?? theme.accent;
  const inScene = words.filter((w) => w.from >= scene.from - 1 && w.from < scene.to);
  let ci = -1;
  for (let i = 0; i < inScene.length; i++) {
    if (inScene[i].from <= frame) ci = i;
    else break;
  }
  if (ci < 0) return null;
  const start = Math.floor(ci / 3) * 3;
  const chunk = inScene.slice(start, ci + 1);
  const shadow = theme.id === "paper-ink"
    ? "0 2px 8px rgba(15,23,42,0.18)"
    : "0 4px 22px rgba(0,0,0,0.85), 0 2px 5px rgba(0,0,0,0.8)";
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", padding: "0 56px 300px" }}>
      <div style={{
        display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "flex-end",
        gap: "0.26em", fontFamily: displayFontFamily, fontWeight: 800, fontSize: 70,
        lineHeight: 1.0, textTransform: "uppercase", textAlign: "center", maxWidth: "100%",
      }}>
        {chunk.map((w, k) => {
          const isCurrent = start + k === ci;
          const hot = w.accent || isCurrent;
          const pop = interpolate(frame, [w.from, w.from + 6], [0, 1], {
            extrapolateLeft: "clamp", extrapolateRight: "clamp",
          });
          return (
            <span
              key={start + k}
              style={{
                color: hot ? theme.accentInk : theme.text,
                background: hot ? sceneAccent : "transparent",
                padding: hot ? "0 0.14em" : 0,
                borderRadius: 10,
                display: "inline-block",
                transform: `translateY(${(1 - pop) * 20}px) scale(${isCurrent ? 1.1 : 0.9 + pop * 0.1})`,
                transformOrigin: "center bottom",
                opacity: pop,
                overflowWrap: "anywhere",
                boxShadow: hot ? `0 8px 30px ${sceneAccent}55` : "none",
                textShadow: hot ? "none" : shadow,
              }}
            >
              {w.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export const ReelsExplainer: React.FC<ReelsExplainerProps> = ({
  audioTrack,
  words,
  scenes,
  totalDurationInFrames,
  music = null,
  musicVolume = 0.1,
  captions = true,
  theme = null,
  themeSeed = null,
}) => {
  const frame = useCurrentFrame();
  const t = resolveTheme(theme, themeSeed ?? audioTrack ?? "reels");
  const idx = scenes.findIndex((s) => frame >= s.from && frame < s.to);
  const active = idx >= 0 ? scenes[idx] : null;
  const accent = active?.data?.accent ?? t.accent;
  const localFrame = active ? frame - active.from : 0;
  const dur = active ? active.to - active.from : 1;

  const inAmt = interpolate(localFrame, [0, 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const outAmt = interpolate(localFrame, [dur - 7, dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const slide = (1 - inAmt) * 70 - outAmt * 60;
  const floatY = Math.sin(frame / 34) * 9;
  const breathe = 1 + Math.sin(frame / 46) * 0.014;
  const opacity = inAmt * (1 - outAmt * 0.85);
  const Comp = active && MOTION_TEMPLATES[active.template] ? MOTION_TEMPLATES[active.template] : null;
  const prog = interpolate(frame, [0, totalDurationInFrames], [0, 100], { extrapolateRight: "clamp" });
  const isVideo = Boolean(active?.file && (active.type === "video" || !Comp));

  return (
    <AbsoluteFill style={{ backgroundColor: t.bg }}>
      {isVideo && active?.file ? (
        <Sequence from={active.from} durationInFrames={Math.max(1, active.to - active.from)} layout="none">
          <AbsoluteFill style={{ backgroundColor: "#0a0a0c" }}>
            {/\.(png|jpe?g|webp|gif)$/i.test(active.file) ? (
              <Img src={staticFile(active.file)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <Video
                src={staticFile(active.file)}
                muted
                objectFit="cover"
                style={{ width: "100%", height: "100%" }}
              />
            )}
          </AbsoluteFill>
        </Sequence>
      ) : (
        <>
          <SceneBackground localFrame={frame} accent={accent} theme={t} />
          <Particles frame={frame} accent={accent} mode={t.particle} />
        </>
      )}

      <div style={{
        position: "absolute", top: 0, left: 0, height: 6, width: `${prog}%`,
        background: accent, boxShadow: `0 0 16px ${accent}`, opacity: 0.9,
      }} />

      {Comp && active && !isVideo ? (
        <AbsoluteFill style={{ opacity, transform: `translateX(${slide}px) translateY(${floatY}px) scale(${breathe})` }}>
          <Comp localFrame={localFrame} duration={dur} {...(active.data ?? {})} />
        </AbsoluteFill>
      ) : null}

      {captions ? <Captions words={words} scene={active} theme={t} /> : null}

      <Audio src={staticFile(audioTrack)} />
      {music ? <Audio src={staticFile(music)} volume={musicVolume} /> : null}
    </AbsoluteFill>
  );
};
