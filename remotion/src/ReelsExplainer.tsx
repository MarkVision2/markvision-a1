import React from "react";
import { AbsoluteFill, Img, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from "remotion";
import { Audio } from "@remotion/media";
import { displayFontFamily } from "./fonts";
import { BRAND } from "./brand";
import { MOTION_TEMPLATES, SceneBackground } from "./motion";
import type { ShortWord } from "./Shorts916";

// ─────────────────────────────────────────────────────────────────────────────
// "Reels-видео" — faceless графический ролик под сгенерённую озвучку. Лица нет:
// весь кадр — живой фон (SceneBackground) + слой частиц + непрерывная лента
// моушн-сцен из библиотеки (по смыслу фразы) + караоке-титры и индикатор сцен.
// Всё постоянно в движении, кадр не «полупустой»: частицы, дрейф, дыхание,
// слайд-переходы между сценами, прогресс сверху.
// ─────────────────────────────────────────────────────────────────────────────

export type ReelsScene = {
  from: number;
  to: number;
  template: string;
  // Живой б-ролл на весь кадр (по смыслу фразы). image → ИИ-картинка + ken-burns;
  // clip → короткий ИИ-видеоклип (для хуков). Поверх — титры и опционально карточка.
  image?: string;
  clip?: string;
  clipFrom?: number;
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
  background?: string; // "grid" (по умолч.) | "aurora" | "warp"
};

const PAPER = BRAND.text;
const CANVAS_W = 1080;
const CANVAS_H = 1920;

// Deterministic pseudo-random so particles are stable frame-to-frame.
const rnd = (i: number, s = 1) => {
  const x = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

// Always-on particle field: accent/white dots drifting up + twinkling. Fills the
// whole frame so empty areas still feel alive.
const Particles: React.FC<{ frame: number; accent: string }> = ({ frame, accent }) => {
  const N = 50;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {Array.from({ length: N }, (_, i) => {
        const x = rnd(i, 1) * CANVAS_W;
        const speed = 0.25 + rnd(i, 2) * 0.9;
        const y = (CANVAS_H + 40 - ((frame * speed + rnd(i, 3) * CANVAS_H) % (CANVAS_H + 80)));
        const size = 3 + Math.floor(rnd(i, 4) * 6);
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
              height: size,
              borderRadius: "50%",
              background: white ? "rgba(255,255,255,0.9)" : accent,
              opacity: tw,
              boxShadow: white ? "0 0 8px rgba(255,255,255,0.5)" : `0 0 10px ${accent}`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

// Живой б-ролл на весь кадр: ИИ-картинка (ken-burns — медленный зум+пан) или
// короткий видеоклип. Сверху — тёмные градиенты (сверху для читаемости UI,
// снизу под титры) + акцентная виньетка, чтобы кадр «сидел» в бренде.
const BrollMedia: React.FC<{ scene: ReelsScene; localFrame: number; duration: number; accent: string }> = ({ scene, localFrame, duration, accent }) => {
  const p = duration > 1 ? localFrame / duration : 0;
  // ken-burns: плавный зум 1.12→1.24 + лёгкий диагональный пан
  const scale = 1.12 + p * 0.12;
  const tx = interpolate(p, [0, 1], [-14, 14]);
  const ty = interpolate(p, [0, 1], [10, -10]);
  const kb: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale}) translate(${tx}px, ${ty}px)` };
  return (
    <AbsoluteFill style={{ backgroundColor: BRAND.bg, overflow: "hidden" }}>
      {scene.clip ? (
        // OffthreadVideo (ffmpeg per-frame extraction) — надёжно проигрывается в
        // headless-рендере, в отличие от @remotion/media Video (замерзал на 1 кадре).
        // Sequence сдвигает таймлайн клипа к началу сцены: клип идёт со своего старта
        // (или clipFrom) ровно когда начинается сцена, а не с глобального времени.
        <Sequence from={scene.from} durationInFrames={Math.max(1, Math.ceil(duration) + 2)}>
          <OffthreadVideo src={staticFile(scene.clip)} trimBefore={scene.clipFrom ?? 0} muted style={kb} />
        </Sequence>
      ) : scene.image ? (
        <Img src={staticFile(scene.image)} style={kb} />
      ) : null}
      {/* градиенты: сверху лёгкий, снизу плотный под титры + акцентная виньетка */}
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(10,12,20,0.55) 0%, rgba(10,12,20,0) 22%, rgba(10,12,20,0) 55%, rgba(10,12,20,0.82) 100%)" }} />
      <AbsoluteFill style={{ boxShadow: `inset 0 0 340px 40px ${accent}22, inset 0 0 200px 0 rgba(0,0,0,0.5)` }} />
    </AbsoluteFill>
  );
};

// Караоке-строка озвучки в безопасной зоне снизу. Слова — только из активной
// сцены (фразы не склеиваются на стыках). Прячется на «текстовых» шаблонах.
const Captions: React.FC<{ words: ShortWord[]; scene: ReelsScene | null }> = ({ words, scene }) => {
  const frame = useCurrentFrame();
  if (!scene) return null;
  // Субтитры голоса — на всех сценах (в безопасной зоне снизу). Скрыть можно
  // только явным data.caption=false на конкретной сцене.
  if (scene.data?.caption === false) return null;
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
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "flex-end", gap: "0.26em", fontFamily: displayFontFamily, fontWeight: 800, fontSize: 70, lineHeight: 1.0, textTransform: "uppercase", textAlign: "center", maxWidth: "100%" }}>
        {chunk.map((w, k) => {
          const isCurrent = start + k === ci;
          const hot = w.accent || isCurrent;
          const pop = interpolate(frame, [w.from, w.from + 6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          return (
            <span
              key={start + k}
              style={{
                color: hot ? BRAND.accentInk : PAPER,
                background: hot ? BRAND.accent : "transparent",
                padding: hot ? "0 0.14em" : 0,
                borderRadius: 10,
                display: "inline-block",
                transform: `translateY(${(1 - pop) * 20}px) scale(${isCurrent ? 1.1 : 0.9 + pop * 0.1})`,
                transformOrigin: "center bottom",
                opacity: pop,
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

// ─── Дополнительные фоны (чтобы ролики не выглядели одинаково) ────────────────
// "aurora" — плавные цветные пятна-градиенты дрейфуют и пульсируют (премиум,
// совсем не как сетка). "warp" — звёздные полосы разлетаются из центра
// (гиперскачок, ударный хук). Выбираются через props.background или scene.data.bg.

const AuroraBackground: React.FC<{ frame: number; accent: string }> = ({ frame, accent }) => {
  const blob = (x: number, y: number, c: string, r: number, dx: number, dy: number, sp: number) => ({
    position: "absolute" as const,
    left: `${x + Math.sin(frame / sp) * dx}%`,
    top: `${y + Math.cos(frame / (sp * 1.3)) * dy}%`,
    width: r,
    height: r,
    borderRadius: "50%",
    background: `radial-gradient(circle, ${c}, transparent 68%)`,
    filter: "blur(60px)",
    opacity: 0.55 + 0.2 * Math.sin(frame / (sp * 0.8)),
  });
  return (
    <AbsoluteFill style={{ background: "linear-gradient(160deg, #0B0A18 0%, #0A0C16 55%, #060810 100%)", overflow: "hidden" }}>
      <div style={blob(8, 6, accent, 760, 8, 6, 90)} />
      <div style={blob(62, 60, "#7C3AED", 820, 10, 8, 120)} />
      <div style={blob(72, 8, "#EC4899", 620, 7, 6, 105)} />
      <div style={blob(18, 66, "#22D3EE", 680, 9, 7, 135)} />
      {/* тонкая зернистая вуаль сверху для глубины */}
      <AbsoluteFill style={{ background: "radial-gradient(120% 90% at 50% 40%, transparent 40%, rgba(4,6,12,0.7) 100%)" }} />
    </AbsoluteFill>
  );
};

const WarpBackground: React.FC<{ frame: number; accent: string }> = ({ frame, accent }) => {
  const N = 90;
  const cx = CANVAS_W / 2;
  const cy = CANVAS_H / 2;
  return (
    <AbsoluteFill style={{ background: "radial-gradient(90% 70% at 50% 50%, #0C1430 0%, #05070F 70%)", overflow: "hidden" }}>
      {Array.from({ length: N }, (_, i) => {
        const ang = rnd(i, 1) * Math.PI * 2;
        const speed = 0.6 + rnd(i, 2) * 1.6;
        // радиус циклически растёт от центра к краю → эффект гиперскачка
        const t = (frame * speed + rnd(i, 3) * 900) % 900;
        const rad = (t / 900) * 1200;
        const x = cx + Math.cos(ang) * rad;
        const y = cy + Math.sin(ang) * rad;
        const len = 6 + (rad / 1200) * 60;
        const op = Math.min(1, rad / 400) * (1 - rad / 1200) * 1.6;
        const white = rnd(i, 6) > 0.6;
        return (
          <div key={i} style={{ position: "absolute", left: x, top: y, width: len, height: 2.5,
            background: white ? "#FFFFFF" : accent, opacity: op, borderRadius: 2,
            transform: `rotate(${(ang * 180) / Math.PI}deg)`, boxShadow: `0 0 8px ${white ? "#fff" : accent}` }} />
        );
      })}
    </AbsoluteFill>
  );
};

const Backdrop: React.FC<{ name: string; frame: number; accent: string }> = ({ name, frame, accent }) => {
  if (name === "aurora") return <AuroraBackground frame={frame} accent={accent} />;
  if (name === "warp") return <WarpBackground frame={frame} accent={accent} />;
  return <SceneBackground localFrame={frame} accent={accent} />;
};

export const ReelsExplainer: React.FC<ReelsExplainerProps> = ({
  audioTrack,
  words,
  scenes,
  totalDurationInFrames,
  music = null,
  musicVolume = 0.1,
  captions = true,
  background = "grid",
}) => {
  const frame = useCurrentFrame();
  const idx = scenes.findIndex((s) => frame >= s.from && frame < s.to);
  const active = idx >= 0 ? scenes[idx] : null;
  const accent = active?.data?.accent ?? BRAND.accent;
  const localFrame = active ? frame - active.from : 0;
  const dur = active ? active.to - active.from : 1;

  // enter: fade + slide-in; exit: slight slide-out near the end of the scene
  const inAmt = interpolate(localFrame, [0, 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const outAmt = interpolate(localFrame, [dur - 7, dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const slide = (1 - inAmt) * 70 - outAmt * 60;
  // continuous idle motion so the scene is never frozen
  const floatY = Math.sin(frame / 34) * 9;
  const breathe = 1 + Math.sin(frame / 46) * 0.014;
  const opacity = inAmt * (1 - outAmt * 0.85);
  const Comp = active && MOTION_TEMPLATES[active.template] ? MOTION_TEMPLATES[active.template] : null;

  // top progress line (constant motion, fills the very top edge)
  const prog = interpolate(frame, [0, totalDurationInFrames], [0, 100], { extrapolateRight: "clamp" });

  const bgName = (active?.data?.bg as string | undefined) ?? background;

  return (
    <AbsoluteFill style={{ backgroundColor: BRAND.bg }}>
      <Backdrop name={bgName} frame={frame} accent={accent} />

      {/* живой б-ролл на весь кадр (если у сцены есть image/clip) — крестфейд */}
      {active && (active.image || active.clip) ? (
        <AbsoluteFill style={{ opacity: inAmt * (1 - outAmt * 0.7) }}>
          <BrollMedia scene={active} localFrame={localFrame} duration={dur} accent={accent} />
        </AbsoluteFill>
      ) : null}

      <Particles frame={frame} accent={accent} />

      {/* top progress line */}
      <div style={{ position: "absolute", top: 0, left: 0, height: 6, width: `${prog}%`, background: accent, boxShadow: `0 0 16px ${accent}`, opacity: 0.9 }} />

      {Comp && active ? (
        <AbsoluteFill style={{ opacity, transform: `translateX(${slide}px) translateY(${floatY}px) scale(${breathe})` }}>
          <Comp localFrame={localFrame} duration={dur} {...(active.data ?? {})} />
        </AbsoluteFill>
      ) : null}

      {captions ? <Captions words={words} scene={active} /> : null}

      <Audio src={staticFile(audioTrack)} />
      {music ? <Audio src={staticFile(music)} volume={musicVolume} /> : null}
    </AbsoluteFill>
  );
};
