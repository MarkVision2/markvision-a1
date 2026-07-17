import React from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  Series,
  getRemotionEnvironment,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { Audio, Video } from "@remotion/media";
import { displayFontFamily } from "./fonts";
import { BRAND } from "./brand";
import { MotionInsertView, SceneBackground } from "./motion";

export type ShortSeg = {
  start: number;
  end: number;
  startFrame: number;
  endFrame: number;
  tx: number; // horizontal crop offset (px) to centre the face
  faceY: number; // face centre Y in % (zoom origin)
};
export type ShortWord = { text: string; from: number; to: number; accent: boolean };
export type ShortPunch = { from: number; originY: number };
type InsertBase = {
  from: number;
  to: number;
  layout?: "third" | "half" | "full"; // how much of the canvas the insert takes
};
// File-based b-roll: a generated image or a source video clip.
export type FileInsert = InsertBase & {
  type: "image" | "video";
  file: string;
  // zone of burned-in subs/watermark to hide, relative 0..1 of the insert area;
  // covered with a blur plate, our karaoke renders on top of everything anyway
  coverBox?: { x: number; y: number; w: number; h: number };
};
// Code-based motion-graphics b-roll (no paid generation) — see motion.tsx.
export type MotionInsert = InsertBase & {
  type: "motion";
  template: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: Record<string, any>;
};
export type ShortInsert = FileInsert | MotionInsert;

export type ShortsProps = {
  src: string;
  previewSrc: string | null;
  fps: number;
  segments: ShortSeg[];
  words: ShortWord[];
  punchZooms: ShortPunch[];
  inserts: ShortInsert[];
  audioTrack: string | null;
  totalDurationInFrames: number;
  // Width the source occupies when scaled to fill canvas height (1920).
  // 16:9 landscape source cropped to vertical → 3413 (default). A natively
  // vertical 9:16 source fills the 1080-wide canvas exactly → pass 1080.
  videoW?: number;
};

const CANVAS_H = 1920;
const DEFAULT_VIDEO_W = Math.round((CANVAS_H * 16) / 9); // 3413: 16:9 source scaled to fill height
// Per-layout insert height and how far the speaker shifts down to stay clear.
// "full" covers the speaker entirely (voice keeps playing) — no shift needed.
const INSERT_LAYOUT = {
  third: { height: Math.round(CANVAS_H / 3), shift: 600 },
  half: { height: Math.round(CANVAS_H / 2), shift: 900 },
  full: { height: CANVAS_H, shift: 0 },
} as const;
const layoutOf = (i: ShortInsert) => INSERT_LAYOUT[i.layout ?? "third"];

const PAPER = BRAND.text; // primary caption colour
const SCARLET = BRAND.accent; // accent colour (accent words, progress bar)
const OUT_QUINT = Easing.bezier(0.16, 1, 0.3, 1);

// Aggressive punch-zoom on accent words.
const PUNCH_SCALE = 1.18;
const PUNCH_IN = 8;
const PUNCH_HOLD = 26;
const PUNCH_OUT = 16;
const CHUNK = 3; // caption words shown per card

const zoomAt = (frame: number, punches: ShortPunch[]) => {
  let scale = 1;
  let originY = 38;
  for (const p of punches) {
    const end = p.from + PUNCH_IN + PUNCH_HOLD + PUNCH_OUT;
    if (frame >= p.from && frame <= end) {
      const s = interpolate(
        frame,
        [p.from, p.from + PUNCH_IN, p.from + PUNCH_IN + PUNCH_HOLD, end],
        [1, PUNCH_SCALE, PUNCH_SCALE, 1],
        { easing: OUT_QUINT, extrapolateLeft: "clamp", extrapolateRight: "clamp" },
      );
      if (s > scale) {
        scale = s;
        originY = p.originY;
      }
    }
  }
  return { scale, originY };
};

// Active insert (if any) at a given frame, plus its fade envelope (0..1).
// The same envelope drives both the insert's opacity and how far the
// speaker shifts down to stay clear of the full-third insert.
const activeInsertAt = (
  frame: number,
  inserts: ShortInsert[],
): { insert: ShortInsert | null; amount: number } => {
  const active = inserts.filter((i) => frame >= i.from && frame < i.to).slice(-1)[0];
  if (!active) return { insert: null, amount: 0 };
  const dur = active.to - active.from;
  const local = frame - active.from;
  const amount = interpolate(local, [0, 7, dur - 7, dur], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return { insert: active, amount };
};

// b-roll fills the top of the canvas edge-to-edge (no card, no border);
// height comes from the insert's layout: third / half / full-screen.
const InsertTop: React.FC<{ insert: ShortInsert | null; opacity: number }> = ({
  insert,
  opacity,
}) => {
  const frame = useCurrentFrame();
  if (!insert) return null;

  // Motion inserts overlay the WHOLE canvas on a transparent layer (glass cards
  // in the upper zone) — no black band, no speaker shift. When data.cover is set,
  // an opaque premium backdrop replaces the speaker and the info is shown big.
  if (insert.type === "motion") {
    const meta = insert.data as { cover?: boolean; accent?: string } | undefined;
    const cover = Boolean(meta?.cover);
    return (
      <AbsoluteFill style={{ opacity }}>
        {cover ? <SceneBackground localFrame={frame - insert.from} accent={meta?.accent} /> : null}
        <MotionInsertView
          template={insert.template}
          from={insert.from}
          to={insert.to}
          data={insert.data}
        />
      </AbsoluteFill>
    );
  }

  // File inserts (image/video) sit in a top band on a dark plate.
  const dur = insert.to - insert.from;
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: layoutOf(insert).height,
        overflow: "hidden",
        opacity,
        backgroundColor: "#17171A",
      }}
    >
      {insert.type === "video" ? (
        <Video
          src={staticFile(insert.file)}
          trimBefore={0}
          trimAfter={dur}
          muted
          objectFit="cover"
          style={{ width: "100%", height: "100%" }}
        />
      ) : (
        <Img
          src={staticFile(insert.file)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      )}
      {insert.coverBox ? (
        <div
          style={{
            position: "absolute",
            left: `${insert.coverBox.x * 100}%`,
            top: `${insert.coverBox.y * 100}%`,
            width: `${insert.coverBox.w * 100}%`,
            height: `${insert.coverBox.h * 100}%`,
            backdropFilter: "blur(26px)",
            backgroundColor: "rgba(20, 20, 23, 0.55)",
          }}
        />
      ) : null}
    </div>
  );
};

const Captions: React.FC<{ words: ShortWord[]; inserts: ShortInsert[] }> = ({ words, inserts }) => {
  const frame = useCurrentFrame();
  // Hide captions while a motion insert is on screen — the overlay already
  // carries the message, so no duplicated text at the bottom.
  if (inserts.some((i) => i.type === "motion" && frame >= i.from && frame < i.to)) {
    return null;
  }
  let ci = -1;
  for (let i = 0; i < words.length; i++) {
    if (words[i].from <= frame) ci = i;
    else break;
  }
  if (ci < 0) return null;
  const start = Math.floor(ci / CHUNK) * CHUNK;
  // only words already spoken (no dim/gray look-ahead)
  const chunk = words.slice(start, ci + 1);

  return (
    <AbsoluteFill
      style={{ justifyContent: "flex-end", alignItems: "center", padding: "0 56px 300px" }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "flex-end",
          gap: "0.28em",
          fontFamily: displayFontFamily,
          fontWeight: 800,
          fontSize: 64,
          lineHeight: 1.02,
          letterSpacing: "0.005em",
          textTransform: "uppercase",
          textAlign: "center",
          maxWidth: "100%",
        }}
      >
        {chunk.map((w, k) => {
          const isCurrent = start + k === ci; // the word being spoken right now
          return (
            <span
              key={start + k}
              style={{
                color: w.accent || isCurrent ? BRAND.accentInk : PAPER,
                background: w.accent || isCurrent ? BRAND.accent : "transparent",
                padding: w.accent || isCurrent ? "0 0.14em" : 0,
                borderRadius: 10,
                transform: w.accent ? "scale(1.06)" : "none",
                transformOrigin: "center bottom",
                overflowWrap: "anywhere",
                boxShadow: w.accent || isCurrent ? `0 8px 30px ${BRAND.accent}55` : "none",
                textShadow:
                  w.accent || isCurrent
                    ? "none"
                    : "0 4px 22px rgba(0,0,0,0.85), 0 2px 5px rgba(0,0,0,0.8)",
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

export const Shorts916: React.FC<ShortsProps> = ({
  src,
  previewSrc,
  segments,
  words,
  punchZooms,
  inserts,
  audioTrack,
  totalDurationInFrames,
  videoW = DEFAULT_VIDEO_W,
}) => {
  const frame = useCurrentFrame();
  const { scale, originY } = zoomAt(frame, punchZooms);
  const { insert: activeInsert, amount: insertAmount } = activeInsertAt(frame, inserts);
  const speakerSrc =
    previewSrc && !getRemotionEnvironment().isRendering ? previewSrc : src;
  const progress = interpolate(frame, [0, totalDurationInFrames], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <AbsoluteFill
        style={{
          transform: `translateY(${insertAmount * (activeInsert && activeInsert.type !== "motion" ? layoutOf(activeInsert).shift : 0)}px) scale(${scale})`,
          transformOrigin: `50% ${originY}%`,
        }}
      >
        <Series>
          {segments.map((s, i) => (
            <Series.Sequence
              key={i}
              durationInFrames={Math.max(1, s.endFrame - s.startFrame)}
              premountFor={30}
            >
              <div style={{ position: "absolute", width: videoW, height: CANVAS_H, left: s.tx, top: 0 }}>
                <Video
                  src={staticFile(speakerSrc)}
                  trimBefore={s.startFrame}
                  trimAfter={s.endFrame}
                  muted={audioTrack != null}
                  objectFit="cover"
                  style={{ width: "100%", height: "100%" }}
                />
              </div>
            </Series.Sequence>
          ))}
        </Series>
      </AbsoluteFill>

      <InsertTop insert={activeInsert} opacity={insertAmount} />
      <Captions words={words} inserts={inserts} />

      {/* progress bar */}
      <div style={{ position: "absolute", top: 0, left: 0, height: 8, width: `${progress}%`, backgroundColor: SCARLET }} />

      {audioTrack ? <Audio src={staticFile(audioTrack)} /> : null}
    </AbsoluteFill>
  );
};
