import React from "react";
import { AbsoluteFill, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Audio, Video } from "@remotion/media";
import { brandFontFamily, displayFontFamily } from "./fonts";
import {
  activeSceneIndex,
  avatarAboveContent,
  avatarGeometry,
  captionChunk,
  contentBox,
  CANVAS_W,
  lerpGeometry,
  SAFE,
  toFrameScenes,
  type AvatarScene,
  type AvatarWord,
  type FrameScene,
} from "./avatarLayout";

// ─────────────────────────────────────────────────────────────────────────────
// "Контент-завод" — говорящая голова (аватар) поверх сгенерированной анимации.
// Основной формат производства: docs/TZ-content-factory-network.md, правила
// раскадровки — .claude/skills/content-factory/templates/scenes.md.
//
// Одно видео аватара смонтировано на всю композицию и меняет только геометрию
// (полный кадр → нижняя треть → круг → прозрачно): так звук не рвётся на стыках
// сцен, а переходы между раскладками получаются плавными.
//
// Цвета берутся ТОЛЬКО из theme аккаунта. Захардкоженных цветов в компонентах
// нет намеренно: однажды чёрный в общем компоненте покрасил всю пачку в один цвет.
// ─────────────────────────────────────────────────────────────────────────────

export type AvatarTheme = { bg: string; accent: string; text: string };

export type ReelsAvatarProps = {
  /** Базовое имя файла аватара в remotion/public (например "avatar/v1.mp4"). */
  avatar: string;
  /** Слова с таймингами (pipeline/transcribe.py → words.json). Пусто — без титров. */
  words?: AvatarWord[];
  scenes: AvatarScene[];
  totalDurationInFrames: number;
  fps: number;
  theme: AvatarTheme;
  /** Отдельная звуковая дорожка. Задана — видео глушится и играет она. */
  audioTrack?: string | null;
  music?: string | null;
  musicVolume?: number;
  captions?: boolean;
  /** Подпись автора в углу (ручка аккаунта). */
  handle?: string | null;
};

const TRANSITION_FRAMES = 8;
const dim = (hex: string, alpha: number) => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

/* ───────────────────────────── визуалы контента ───────────────────────────── */

type VisualProps = { scene: FrameScene; theme: AvatarTheme; local: number };

const Stat: React.FC<VisualProps> = ({ scene, theme, local }) => {
  const pop = interpolate(local, [0, 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{
        fontFamily: displayFontFamily, fontWeight: 900, fontSize: 220, lineHeight: 1,
        color: theme.accent, transform: `scale(${0.86 + pop * 0.14})`, opacity: pop,
        textShadow: `0 18px 60px ${dim(theme.accent, 0.35)}`,
      }}>
        {scene.value ?? scene.title}
      </div>
      {scene.label ? (
        <div style={{
          fontFamily: brandFontFamily, fontSize: 52, marginTop: 24, color: theme.text,
          opacity: interpolate(local, [8, 20], [0, 0.85], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}>
          {scene.label}
        </div>
      ) : null}
    </div>
  );
};

const List: React.FC<VisualProps> = ({ scene, theme, local }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 28, width: "100%" }}>
    {(scene.bullets ?? []).slice(0, 4).map((b, i) => {
      const appear = interpolate(local, [i * 9, i * 9 + 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
      return (
        <div key={i} style={{
          display: "flex", alignItems: "center", gap: 24,
          transform: `translateY(${(1 - appear) * 26}px)`, opacity: appear,
        }}>
          <span style={{
            flex: "0 0 auto", width: 18, height: 18, borderRadius: 9, background: theme.accent,
            boxShadow: `0 0 24px ${dim(theme.accent, 0.6)}`,
          }} />
          <span style={{ fontFamily: brandFontFamily, fontSize: 56, lineHeight: 1.2, color: theme.text }}>{b}</span>
        </div>
      );
    })}
  </div>
);

const Quote: React.FC<VisualProps> = ({ scene, theme, local }) => {
  const appear = interpolate(local, [0, 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ opacity: appear, transform: `translateY(${(1 - appear) * 20}px)`, textAlign: "center" }}>
      <div style={{ fontFamily: displayFontFamily, fontWeight: 900, fontSize: 96, lineHeight: 1.05, color: theme.accent, marginBottom: 18 }}>«</div>
      <div style={{ fontFamily: brandFontFamily, fontSize: 64, lineHeight: 1.25, color: theme.text }}>{scene.title}</div>
      {scene.label ? (
        <div style={{ fontFamily: brandFontFamily, fontSize: 40, marginTop: 28, color: dim(theme.text, 0.6) }}>{scene.label}</div>
      ) : null}
    </div>
  );
};

const Compare: React.FC<VisualProps> = ({ scene, theme, local }) => {
  const cols: [string, string][] = [["Было", scene.left ?? ""], ["Стало", scene.right ?? ""]];
  return (
    <div style={{ display: "flex", gap: 28, width: "100%" }}>
      {cols.map(([cap, val], i) => {
        const appear = interpolate(local, [i * 10, i * 10 + 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        const hot = i === 1;
        return (
          <div key={cap} style={{
            flex: 1, padding: "36px 28px", borderRadius: 28,
            background: hot ? dim(theme.accent, 0.16) : dim(theme.text, 0.07),
            border: `2px solid ${hot ? theme.accent : dim(theme.text, 0.16)}`,
            opacity: appear, transform: `translateY(${(1 - appear) * 24}px)`,
          }}>
            <div style={{ fontFamily: brandFontFamily, fontSize: 34, color: dim(theme.text, 0.65), marginBottom: 14 }}>{cap}</div>
            <div style={{
              fontFamily: displayFontFamily, fontWeight: 800, fontSize: 60, lineHeight: 1.1,
              color: hot ? theme.accent : theme.text,
            }}>
              {val}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const Title: React.FC<VisualProps & { big: boolean }> = ({ scene, theme, local, big }) => {
  const appear = interpolate(local, [0, 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (!scene.title) return null;
  return (
    <div style={{
      fontFamily: displayFontFamily, fontWeight: 900, fontSize: big ? 92 : 68, lineHeight: 1.08,
      color: theme.text, textAlign: big ? "center" : "left", opacity: appear,
      transform: `translateY(${(1 - appear) * 22}px)`,
      textShadow: big ? `0 8px 40px ${dim("#000000", 0.6)}` : "none",
    }}>
      {scene.title}
    </div>
  );
};

const SceneContent: React.FC<VisualProps> = (p) => {
  const { scene } = p;
  switch (scene.visual) {
    case "stat": return <Stat {...p} />;
    case "list": return <List {...p} />;
    case "quote": return <Quote {...p} />;
    case "compare": return <Compare {...p} />;
    default: return <Title {...p} big={scene.layout === "avatar_full" || scene.layout === "content_full"} />;
  }
};

/* ───────────────────────────── титры ───────────────────────────── */

const Captions: React.FC<{ words: AvatarWord[]; theme: AvatarTheme; frameMs: number; bottom: number }> = ({
  words, theme, frameMs, bottom,
}) => {
  const chunk = captionChunk(words, frameMs);
  if (!chunk.length) return null;
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", padding: `0 ${SAFE.side}px ${bottom}px` }}>
      <div style={{
        display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "0.22em",
        fontFamily: displayFontFamily, fontWeight: 800, fontSize: 62, lineHeight: 1.05,
        textTransform: "uppercase", textAlign: "center",
      }}>
        {chunk.map((w, i) => {
          const current = i === chunk.length - 1;
          const hot = Boolean(w.accent) || current;
          return (
            <span key={`${w.from_ms}-${i}`} style={{
              color: hot ? theme.bg : theme.text,
              background: hot ? theme.accent : "transparent",
              padding: hot ? "0 0.12em" : 0,
              borderRadius: 10,
              textShadow: hot ? "none" : `0 4px 20px ${dim("#000000", 0.85)}`,
            }}>
              {w.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

/* ───────────────────────────── композиция ───────────────────────────── */

export const ReelsAvatar: React.FC<ReelsAvatarProps> = ({
  avatar,
  words = [],
  scenes,
  totalDurationInFrames,
  fps,
  theme,
  audioTrack = null,
  music = null,
  musicVolume = 0.12,
  captions = true,
  handle = null,
}) => {
  const frame = useCurrentFrame();
  const { fps: configFps } = useVideoConfig();
  const rate = fps || configFps;
  const framed = toFrameScenes(scenes, rate);
  const idx = activeSceneIndex(framed, frame);
  const scene = idx >= 0 ? framed[idx] : framed[0];
  if (!scene) return <AbsoluteFill style={{ backgroundColor: theme.bg }} />;

  const prev = idx > 0 ? framed[idx - 1] : scene;
  const local = frame - scene.from;
  const t = interpolate(local, [0, TRANSITION_FRAMES], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const geo = lerpGeometry(avatarGeometry(prev.layout), avatarGeometry(scene.layout), t);
  const box = contentBox(scene.layout);
  const above = avatarAboveContent(scene.layout);
  const contentPad = scene.layout === "avatar_bottom" ? SAFE.top : SAFE.top + 40;
  const progress = interpolate(frame, [0, totalDurationInFrames], [0, 100], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
      {/* контент: подложка непрозрачна везде, кроме avatar_full */}
      <AbsoluteFill style={{ zIndex: 2 }}>
        <div style={{
          position: "absolute", left: 0, top: box.top, width: CANVAS_W, height: box.height,
          background: box.opaque ? theme.bg : "transparent",
          display: "flex", flexDirection: "column",
          justifyContent: scene.layout === "avatar_bottom" ? "flex-start" : "center",
          alignItems: "center",
          padding: `${contentPad}px ${SAFE.side}px ${scene.layout === "avatar_bottom" ? 60 : SAFE.bottom}px`,
          boxSizing: "border-box",
        }}>
          <SceneContent scene={scene} theme={theme} local={local} />
        </div>
      </AbsoluteFill>

      {/* аватар: один смонтированный элемент на всю композицию — звук без разрывов */}
      <div style={{
        position: "absolute",
        left: geo.left, top: geo.top, width: geo.width, height: geo.height,
        borderRadius: geo.radius, overflow: "hidden", opacity: geo.opacity,
        zIndex: above ? 3 : 1,
        border: scene.layout === "avatar_circle" ? `4px solid ${theme.accent}` : "none",
        boxShadow: scene.layout === "avatar_circle" ? `0 24px 70px ${dim("#000000", 0.5)}` : "none",
        boxSizing: "border-box",
      }}>
        <Video
          src={staticFile(avatar)}
          muted={audioTrack != null}
          objectFit="cover"
          style={{ width: "100%", height: "100%", objectPosition: "50% 32%" }}
        />
      </div>

      {/* титры — только там, где низ кадра свободен */}
      {captions && words.length && (scene.layout === "avatar_full" || scene.layout === "content_full") ? (
        <AbsoluteFill style={{ zIndex: 4 }}>
          <Captions words={words} theme={theme} frameMs={(frame / rate) * 1000} bottom={SAFE.bottom + 40} />
        </AbsoluteFill>
      ) : null}

      {handle ? (
        <div style={{
          position: "absolute", zIndex: 5, left: SAFE.side, top: SAFE.top - 90,
          fontFamily: brandFontFamily, fontSize: 34, color: dim(theme.text, 0.55),
        }}>
          {handle}
        </div>
      ) : null}

      {/* полоса прогресса — зритель видит, что ролик короткий */}
      <div style={{ position: "absolute", zIndex: 6, left: 0, bottom: 0, width: `${progress}%`, height: 6, background: theme.accent }} />

      {audioTrack ? <Audio src={staticFile(audioTrack)} /> : null}
      {music ? <Audio src={staticFile(music)} volume={musicVolume} /> : null}
    </AbsoluteFill>
  );
};
