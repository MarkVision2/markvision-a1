import React from "react";
import { AbsoluteFill, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Audio } from "@remotion/media";
import { displayFontFamily } from "./fonts";
import { BRAND } from "./brand";
import { MOTION_TEMPLATES, SceneBackground } from "./motion";
import type { ShortWord } from "./Shorts916";

// ─────────────────────────────────────────────────────────────────────────────
// "Reels-видео" — faceless графический ролик под сгенерённую озвучку. Лица нет:
// весь кадр — анимированный фон (SceneBackground) + непрерывная лента моушн-сцен
// из библиотеки (motion.tsx), выбранных ПО СМЫСЛУ фразы, плюс караоке-титры
// проговариваемой строки в безопасной зоне снизу. Звук — только озвучка (+музыка).
//
// scenes[] — стык в стык покрывают всю дорожку; каждая сцена = template+data и
// своя фраза. Титры прячутся на «текстовых» шаблонах (big-statement/kinetic-type/
// quote-card/lower-third) и по флагу data.caption=false, чтобы текст не дублировался.
// ─────────────────────────────────────────────────────────────────────────────

export type ReelsScene = {
  from: number;
  to: number;
  template: string;
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
};

const PAPER = BRAND.text;
// Шаблоны, которые сами несут крупный текст фразы — караоке-строку под ними прячем.
const TEXT_TEMPLATES = new Set(["big-statement", "kinetic-type", "quote-card", "lower-third"]);

// Караоке-строка озвучки в безопасной зоне снизу (не ниже ~320px UI-зоны Reels).
// Слова берём только из активной сцены, чтобы фразы не склеивались на стыках.
const Captions: React.FC<{ words: ShortWord[]; scene: ReelsScene | null }> = ({ words, scene }) => {
  const frame = useCurrentFrame();
  if (!scene) return null;
  if (scene.data?.caption === false || TEXT_TEMPLATES.has(scene.template)) return null;

  const inScene = words.filter((w) => w.from >= scene.from - 1 && w.from < scene.to);
  let ci = -1;
  for (let i = 0; i < inScene.length; i++) {
    if (inScene[i].from <= frame) ci = i;
    else break;
  }
  if (ci < 0) return null;
  const start = Math.floor(ci / 3) * 3;
  const chunk = inScene.slice(start, ci + 1);

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", padding: "0 56px 300px" }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "flex-end",
          gap: "0.26em",
          fontFamily: displayFontFamily,
          fontWeight: 800,
          fontSize: 70,
          lineHeight: 1.0,
          textTransform: "uppercase",
          textAlign: "center",
          maxWidth: "100%",
        }}
      >
        {chunk.map((w, k) => {
          const isCurrent = start + k === ci;
          const hot = w.accent || isCurrent;
          return (
            <span
              key={start + k}
              style={{
                color: hot ? BRAND.accentInk : PAPER,
                background: hot ? BRAND.accent : "transparent",
                padding: hot ? "0 0.14em" : 0,
                borderRadius: 10,
                transform: isCurrent ? "scale(1.1)" : "none",
                transformOrigin: "center bottom",
                overflowWrap: "anywhere",
                boxShadow: hot ? `0 8px 30px ${BRAND.accent}55` : "none",
                textShadow: hot ? "none" : "0 4px 22px rgba(0,0,0,0.85), 0 2px 5px rgba(0,0,0,0.8)",
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
  music = null,
  musicVolume = 0.1,
  captions = true,
}) => {
  const frame = useCurrentFrame();
  const idx = scenes.findIndex((s) => frame >= s.from && frame < s.to);
  const active = idx >= 0 ? scenes[idx] : null;
  const accent = active?.data?.accent ?? BRAND.accent;

  // мягкий переход между сценами: короткий fade+lift на входе каждой сцены
  const localFrame = active ? frame - active.from : 0;
  const scene = active ? interpolate(localFrame, [0, 7], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  const Comp = active && MOTION_TEMPLATES[active.template] ? MOTION_TEMPLATES[active.template] : null;

  return (
    <AbsoluteFill style={{ backgroundColor: BRAND.bg }}>
      {/* непрерывно живой фон; акцент — от активной сцены */}
      <SceneBackground localFrame={frame} accent={accent} />

      {Comp && active ? (
        <AbsoluteFill style={{ opacity: scene, transform: `translateY(${(1 - scene) * 26}px)` }}>
          <Comp localFrame={localFrame} duration={active.to - active.from} {...(active.data ?? {})} />
        </AbsoluteFill>
      ) : null}

      {captions ? <Captions words={words} scene={active} /> : null}

      <Audio src={staticFile(audioTrack)} />
      {music ? <Audio src={staticFile(music)} volume={musicVolume} /> : null}
    </AbsoluteFill>
  );
};
