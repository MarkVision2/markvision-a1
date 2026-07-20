import React from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
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
  // Caption look: "pill" (bottom-centre, accent pill), "left-stack" (left,
  // word-stacked, cream + accent, hops position), "mixed" (alternates the two
  // per phrase), "karaoke-box" (dark plate + yellow active word, keeps captions
  // visible during cover motion — expert-explainer style).
  captionStyle?: "pill" | "left-stack" | "mixed" | "karaoke-box";
  /** When true, karaoke captions stay on screen during motion cover scenes. */
  keepCaptionsOnCover?: boolean;
  /** Disable punch + ken-burns zoom (default true for montage lab — no creepy zoom). */
  disableZoom?: boolean;
  // Background music file in public/ (played quietly under the voice), or null.
  music?: string | null;
  musicVolume?: number;
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

/** Fade envelope for an insert Sequence (frame is relative to Sequence start). */
const InsertFade: React.FC<{ insert: ShortInsert }> = ({ insert }) => {
  const frame = useCurrentFrame();
  const dur = Math.max(1, insert.to - insert.from);
  const opacity = interpolate(frame, [0, 7, Math.max(8, dur - 7), dur], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return <InsertTop insert={insert} opacity={opacity} />;
};

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
// IMPORTANT: must be rendered inside <Sequence from={insert.from}> so
// @remotion/media <Video> timeline starts at 0. Without Sequence the Video
// seeks to the absolute composition frame, overshoots trimAfter → grey plate.
const InsertTop: React.FC<{ insert: ShortInsert; opacity: number }> = ({
  insert,
  opacity,
}) => {
  const frame = useCurrentFrame(); // relative to wrapping Sequence → 0 at insert start
  const dur = Math.max(1, insert.to - insert.from);

  // Motion inserts overlay the WHOLE canvas on a transparent layer (glass cards
  // in the upper zone) — no black band, no speaker shift. When data.cover is set,
  // an opaque premium backdrop replaces the speaker and the info is shown big.
  if (insert.type === "motion") {
    const meta = insert.data as { cover?: boolean; accent?: string } | undefined;
    const cover = Boolean(meta?.cover);
    const local = frame;
    // Cover scenes swipe in from the right and out to the left (transition feel).
    const enterX = interpolate(local, [0, 8], [240, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    const exitX = interpolate(local, [dur - 8, dur], [0, -240], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    const tx = cover ? enterX + exitX : 0;
    return (
      <AbsoluteFill style={{ opacity, transform: `translateX(${tx}px)` }}>
        {cover ? <SceneBackground localFrame={local} accent={meta?.accent} /> : null}
        <MotionInsertView
          template={insert.template}
          from={0}
          to={dur}
          data={insert.data}
        />
      </AbsoluteFill>
    );
  }

  // File inserts (image/video). Video b-roll = full cutaway by default height;
  // third/half leave a grey band + speaker crushed at the bottom if Video fails
  // or looks like a broken 50/50.
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

const CREAM = "#F4EFE0";
const CAP_YELLOW = "#F5E14B";

// Anchors the dynamic caption block cycles through between phrases (runs), so
// the titles move around the frame (left / lower / upper / right) like the ref.
const CAP_POS: React.CSSProperties[] = [
  { justifyContent: "flex-end", alignItems: "flex-start", padding: "0 0 380px 60px" }, // lower-left
  { justifyContent: "center", alignItems: "flex-start", padding: "0 0 0 60px" },        // mid-left
  { justifyContent: "flex-end", alignItems: "flex-end", padding: "0 60px 440px 0", textAlign: "right" }, // lower-right
  { justifyContent: "center", alignItems: "flex-start", padding: "220px 0 0 60px" },    // upper-left
];

const Captions: React.FC<{
  words: ShortWord[];
  inserts: ShortInsert[];
  style?: "pill" | "left-stack" | "mixed" | "karaoke-box";
  keepCaptionsOnCover?: boolean;
}> = ({ words, inserts, style = "pill", keepCaptionsOnCover = false }) => {
  const frame = useCurrentFrame();
  // Expert-explainer keeps karaoke visible on cover scenes (reference does).
  // Other styles hide captions while a motion insert carries the thought.
  const covered = (f: number) =>
    !keepCaptionsOnCover &&
    inserts.some((i) => i.type === "motion" && f >= i.from && f < i.to);
  // Hide captions outright while a covering insert is on screen (unless keepCaptionsOnCover).
  if (covered(frame)) return null;
  const vis = words.filter((w) => !covered(w.from));
  let ci = -1;
  for (let i = 0; i < vis.length; i++) {
    if (vis[i].from <= frame) ci = i;
    else break;
  }
  if (ci < 0) return null;

  // Captions must not read across an insert: an overlay in the gap means the
  // phrase was interrupted, so start a fresh caption "run" after it. This stops
  // stranded words from opposite ends gluing into nonsense ("чтобы …ЖМИ… регистрируйся").
  let runStart = ci;
  while (runStart > 0) {
    const prev = vis[runStart - 1];
    const cur = vis[runStart];
    const insertBetween = inserts.some(
      (i) => i.type === "motion" && i.from >= prev.from && i.to <= cur.from + 1,
    );
    if (insertBetween) break;
    runStart--;
  }

  // how many runs (phrases) have started up to now → cycles positions and,
  // in "mixed" mode, alternates the caption style between phrases.
  let runIndex = 0;
  for (let i = 1; i <= ci; i++) {
    const brk = inserts.some(
      (ins) => ins.type === "motion" && ins.from >= vis[i - 1].from && ins.to <= vis[i].from + 1,
    );
    if (brk) runIndex++;
  }
  const eff =
    style === "mixed"
      ? (runIndex % 2 === 1 ? "left-stack" : "pill")
      : style;

  // ── left-stack (dynamic): running words that pop in and hop position per run ──
  if (eff === "left-stack") {
    const pos = CAP_POS[runIndex % CAP_POS.length];
    const runWords = vis.slice(runStart, ci + 1).slice(-6); // current phrase, last ≤6 words
    const firstIdx = ci - runWords.length + 1;
    return (
      <AbsoluteFill style={{ ...pos }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: pos.textAlign === "right" ? "flex-end" : "flex-start",
            gap: "0.08em 0.22em",
            maxWidth: 640,
            fontFamily: displayFontFamily,
            fontWeight: 900,
            textTransform: "uppercase",
            lineHeight: 1.0,
            textAlign: (pos.textAlign as "left" | "right") ?? "left",
            textShadow: "0 4px 26px rgba(0,0,0,0.8), 0 2px 6px rgba(0,0,0,0.75)",
          }}
        >
          {runWords.map((w, k) => {
            const p = interpolate(frame, [w.from, w.from + 7], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            return (
              <span
                key={firstIdx + k}
                style={{
                  color: w.accent ? CAP_YELLOW : CREAM,
                  fontSize: w.accent ? 100 : 58,
                  letterSpacing: "0.01em",
                  transform: `translateY(${(1 - p) * 22}px) scale(${0.85 + p * 0.15})`,
                  transformOrigin: "left bottom",
                  opacity: p,
                }}
              >
                {w.text}
              </span>
            );
          })}
        </div>
      </AbsoluteFill>
    );
  }

  // group in 3s but never cross a run boundary (keeps phrases meaningful)
  const start = Math.max(runStart, Math.floor(ci / CHUNK) * CHUNK);
  // only words already spoken (no dim/gray look-ahead)
  const chunk = vis.slice(start, ci + 1);
  const karaokeBox = eff === "karaoke-box";

  return (
    <AbsoluteFill
      style={{ justifyContent: "flex-end", alignItems: "center", padding: "0 48px 280px" }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "flex-end",
          gap: karaokeBox ? "0.18em" : "0.28em",
          fontFamily: displayFontFamily,
          fontWeight: 800,
          fontSize: karaokeBox ? 68 : 74,
          lineHeight: 1.05,
          letterSpacing: "0.005em",
          textTransform: "uppercase",
          textAlign: "center",
          maxWidth: "100%",
          ...(karaokeBox
            ? {
                background: "rgba(12, 14, 18, 0.82)",
                borderRadius: 18,
                padding: "14px 22px",
                boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
              }
            : {}),
        }}
      >
        {chunk.map((w, k) => {
          const isCurrent = start + k === ci; // the word being spoken right now
          const hot = w.accent || isCurrent;
          return (
            <span
              key={start + k}
              style={{
                color: hot ? (karaokeBox ? "#0A0C14" : BRAND.accentInk) : PAPER,
                background: hot ? (karaokeBox ? CAP_YELLOW : BRAND.accent) : "transparent",
                padding: hot ? "0 0.14em" : 0,
                borderRadius: 10,
                transform: isCurrent ? "scale(1.12)" : "none",
                transformOrigin: "center bottom",
                overflowWrap: "anywhere",
                boxShadow: hot
                  ? karaokeBox
                    ? "0 4px 16px rgba(245,225,75,0.35)"
                    : `0 8px 30px ${BRAND.accent}55`
                  : "none",
                textShadow:
                  hot || karaokeBox
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
  captionStyle = "pill",
  keepCaptionsOnCover = false,
  disableZoom = true,
  music = null,
  musicVolume = 0.12,
}) => {
  const frame = useCurrentFrame();
  // По умолчанию зум выключен: постоянный ken-burns + punch выглядят «стремно»
  // на говорящей голове. Включается только явным disableZoom={false}.
  const { scale, originY } = zoomAt(frame, disableZoom ? [] : punchZooms);
  const baseZoom = disableZoom ? 1 : 1.06 + 0.035 * Math.sin(frame / 42);
  const finalScale = baseZoom * scale;
  const { insert: activeInsert, amount: insertAmount } = activeInsertAt(frame, inserts);
  const speakerSrc =
    previewSrc && !getRemotionEnvironment().isRendering ? previewSrc : src;
  const progress = interpolate(frame, [0, totalDurationInFrames], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const captionsStay =
    keepCaptionsOnCover || captionStyle === "karaoke-box";

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <AbsoluteFill
        style={{
          transform: `translateY(${insertAmount * (activeInsert && activeInsert.type !== "motion" ? layoutOf(activeInsert).shift : 0)}px) scale(${finalScale})`,
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

      {inserts.map((ins, i) => {
        const dur = Math.max(1, ins.to - ins.from);
        return (
          <Sequence
            key={`ins-${i}-${ins.from}`}
            from={ins.from}
            durationInFrames={dur}
            premountFor={20}
            layout="none"
          >
            <InsertFade insert={ins} />
          </Sequence>
        );
      })}
      <Captions
        words={words}
        inserts={inserts}
        style={captionStyle}
        keepCaptionsOnCover={captionsStay}
      />

      {/* progress bar */}
      <div style={{ position: "absolute", top: 0, left: 0, height: 8, width: `${progress}%`, backgroundColor: SCARLET }} />

      {audioTrack ? <Audio src={staticFile(audioTrack)} /> : null}
      {music ? <Audio src={staticFile(music)} volume={musicVolume} /> : null}
    </AbsoluteFill>
  );
};
