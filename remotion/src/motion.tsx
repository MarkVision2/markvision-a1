import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { brandFontFamily } from "./fonts";
import { BRAND } from "./brand";

// ─────────────────────────────────────────────────────────────────────────────
// Code-based motion-graphics b-roll (no paid image generation).
// Each template fills its InsertTop box (100% w/h) and paints its own
// background — opaque templates cover the speaker, "annotate" stays transparent
// and overlays the speaker. Templates receive `localFrame` (frames since the
// insert started) and `duration`, so animation is relative to the insert.
//
// Insert usage (in props inserts[]):
//   { type: "motion", template: "number-counter", from, to, layout: "full",
//     data: { value: 10, suffix: "часов", label: "экономит в неделю" } }
// ─────────────────────────────────────────────────────────────────────────────

export type MotionBaseProps = { localFrame: number; duration: number };

const FONT = brandFontFamily;

// Shared: springy 0→1 entrance, clamped.
const enter = (local: number, fps: number, delay = 0, damping = 200) =>
  spring({ frame: local - delay, fps, config: { damping }, durationInFrames: 22 });

// Shared full-bleed opaque stage for "cover" templates.
const Stage: React.FC<{ children: React.ReactNode; pad?: number }> = ({
  children,
  pad = 90,
}) => (
  <AbsoluteFill
    style={{
      backgroundColor: BRAND.bg,
      fontFamily: FONT,
      color: BRAND.text,
      padding: pad,
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      textTransform: "uppercase",
    }}
  >
    {children}
  </AbsoluteFill>
);

// ── number-counter — a key figure rolls up ──────────────────────────────────
export const NumberCounter: React.FC<
  MotionBaseProps & { value?: number; prefix?: string; suffix?: string; label?: string; decimals?: number }
> = ({ localFrame, value = 100, prefix = "", suffix = "", label = "", decimals = 0 }) => {
  const { fps } = useVideoConfig();
  const p = spring({ frame: localFrame, fps, config: { damping: 200 }, durationInFrames: 34 });
  const shown = (value * p).toFixed(decimals);
  const pop = enter(localFrame, fps, 6);
  return (
    <Stage>
      <div style={{ display: "flex", alignItems: "baseline", gap: 18, transform: `scale(${0.9 + pop * 0.1})`, transformOrigin: "left" }}>
        <span style={{ fontSize: 300, fontWeight: 800, lineHeight: 0.9, color: BRAND.accent, letterSpacing: "-0.02em" }}>
          {prefix}
          {shown}
        </span>
        {suffix ? <span style={{ fontSize: 96, fontWeight: 800 }}>{suffix}</span> : null}
      </div>
      {label ? (
        <div style={{ marginTop: 30, fontSize: 74, fontWeight: 800, opacity: enter(localFrame, fps, 12) }}>{label}</div>
      ) : null}
    </Stage>
  );
};

// ── vs-compare — "вручную" vs "автоматизировано" split ───────────────────────
export const VsCompare: React.FC<
  MotionBaseProps & { leftTitle?: string; rightTitle?: string; leftItems?: string[]; rightItems?: string[] }
> = ({
  localFrame,
  leftTitle = "ВРУЧНУЮ",
  rightTitle = "С ИИ",
  leftItems = ["Медленно", "Дорого", "Ошибки"],
  rightItems = ["Быстро", "Дёшево", "Точно"],
}) => {
  const { fps } = useVideoConfig();
  const Col: React.FC<{ title: string; items: string[]; good: boolean; base: number }> = ({ title, items, good, base }) => (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 26 }}>
      <div
        style={{
          fontSize: 66,
          fontWeight: 800,
          padding: "18px 0",
          textAlign: "center",
          color: good ? BRAND.accentInk : BRAND.text,
          backgroundColor: good ? BRAND.accent : "#1C1C22",
          borderRadius: 20,
          opacity: enter(localFrame, fps, base),
        }}
      >
        {title}
      </div>
      {items.map((it, i) => {
        const o = enter(localFrame, fps, base + 6 + i * 6);
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 52, fontWeight: 800, opacity: o, transform: `translateX(${(1 - o) * (good ? 40 : -40)}px)` }}>
            <span style={{ fontSize: 60, color: good ? BRAND.accent : BRAND.textDim }}>{good ? "✓" : "✕"}</span>
            <span style={{ color: good ? BRAND.text : BRAND.textDim }}>{it}</span>
          </div>
        );
      })}
    </div>
  );
  return (
    <Stage>
      <div style={{ display: "flex", gap: 60, alignItems: "flex-start" }}>
        <Col title={leftTitle} items={leftItems} good={false} base={0} />
        <Col title={rightTitle} items={rightItems} good base={10} />
      </div>
    </Stage>
  );
};

// ── checklist-reveal — items tick in one by one ──────────────────────────────
export const ChecklistReveal: React.FC<MotionBaseProps & { title?: string; items?: string[] }> = ({
  localFrame,
  title = "",
  items = ["Пункт один", "Пункт два", "Пункт три"],
}) => {
  const { fps } = useVideoConfig();
  return (
    <Stage>
      {title ? <div style={{ fontSize: 78, fontWeight: 800, color: BRAND.accent, marginBottom: 44 }}>{title}</div> : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
        {items.map((it, i) => {
          const s = enter(localFrame, fps, 8 + i * 12);
          const checked = enter(localFrame, fps, 14 + i * 12);
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 30, opacity: s, transform: `translateY(${(1 - s) * 30}px)` }}>
              <div style={{ width: 78, height: 78, borderRadius: 18, backgroundColor: checked > 0.5 ? BRAND.accent : "#1C1C22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 54, fontWeight: 800, color: BRAND.accentInk, transform: `scale(${0.7 + checked * 0.3})` }}>
                {checked > 0.5 ? "✓" : ""}
              </div>
              <span style={{ fontSize: 58, fontWeight: 800 }}>{it}</span>
            </div>
          );
        })}
      </div>
    </Stage>
  );
};

// ── fake-terminal — commands type out, then "done" ───────────────────────────
export const FakeTerminal: React.FC<MotionBaseProps & { lines?: string[]; done?: string }> = ({
  localFrame,
  lines = ["$ ai automate --task inbox", "→ анализирую письма...", "→ пишу ответы...", "✓ готово за 4 секунды"],
}) => {
  const perLine = 18;
  return (
    <AbsoluteFill style={{ backgroundColor: BRAND.bg, padding: 70, justifyContent: "center", fontFamily: "'SF Mono','JetBrains Mono',ui-monospace,monospace" }}>
      <div style={{ backgroundColor: "#111117", borderRadius: 28, border: "2px solid #26262E", padding: "40px 44px", boxShadow: "0 30px 80px rgba(0,0,0,0.6)" }}>
        <div style={{ display: "flex", gap: 14, marginBottom: 34 }}>
          {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
            <div key={c} style={{ width: 26, height: 26, borderRadius: "50%", backgroundColor: c }} />
          ))}
        </div>
        {lines.map((ln, i) => {
          const start = i * perLine;
          const chars = Math.max(0, Math.floor((localFrame - start) * 2.2));
          if (localFrame < start) return <div key={i} style={{ height: 68 }} />;
          const text = ln.slice(0, chars);
          const typing = chars < ln.length;
          const accent = ln.startsWith("✓");
          return (
            <div key={i} style={{ fontSize: 46, lineHeight: 1.5, color: accent ? BRAND.accent : BRAND.text, fontWeight: 600 }}>
              {text}
              {typing && Math.floor(localFrame / 8) % 2 === 0 ? <span style={{ color: BRAND.accent }}>▋</span> : null}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ── fake-dashboard-bars — animated metric bars grow ──────────────────────────
export const FakeDashboardBars: React.FC<
  MotionBaseProps & { title?: string; bars?: { label: string; value: number }[] }
> = ({
  localFrame,
  title = "РЕЗУЛЬТАТ",
  bars = [
    { label: "До", value: 30 },
    { label: "Через месяц", value: 72 },
    { label: "Через 3 мес", value: 100 },
  ],
}) => {
  const { fps } = useVideoConfig();
  const max = Math.max(...bars.map((b) => b.value), 1);
  return (
    <Stage>
      <div style={{ fontSize: 74, fontWeight: 800, color: BRAND.accent, marginBottom: 50 }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 46 }}>
        {bars.map((b, i) => {
          const g = spring({ frame: localFrame - 8 - i * 8, fps, config: { damping: 200 }, durationInFrames: 30 });
          const w = (b.value / max) * 100 * g;
          const last = i === bars.length - 1;
          return (
            <div key={i}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 44, fontWeight: 800, marginBottom: 14 }}>
                <span style={{ color: BRAND.textDim }}>{b.label}</span>
                <span style={{ color: last ? BRAND.accent : BRAND.text }}>{Math.round(b.value * g)}%</span>
              </div>
              <div style={{ height: 60, borderRadius: 14, backgroundColor: "#1C1C22", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${w}%`, backgroundColor: last ? BRAND.accent : "#3A3A44", borderRadius: 14 }} />
              </div>
            </div>
          );
        })}
      </div>
    </Stage>
  );
};

// ── kinetic-type — a punchy phrase snaps in word by word ─────────────────────
export const KineticType: React.FC<MotionBaseProps & { words?: string[]; accentIndex?: number }> = ({
  localFrame,
  words = ["АВТОМАТИЗИРУЙ", "ВСЁ", "СЕЙЧАС"],
  accentIndex = 1,
}) => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ backgroundColor: BRAND.bg, justifyContent: "center", alignItems: "center", fontFamily: FONT, textTransform: "uppercase", padding: 80 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
        {words.map((w, i) => {
          const s = spring({ frame: localFrame - i * 7, fps, config: { damping: 14, mass: 0.6 }, durationInFrames: 20 });
          const acc = i === accentIndex;
          return (
            <div key={i} style={{ fontSize: acc ? 168 : 128, fontWeight: 800, lineHeight: 0.95, color: acc ? BRAND.accentInk : BRAND.text, backgroundColor: acc ? BRAND.accent : "transparent", padding: acc ? "6px 30px" : 0, borderRadius: 18, transform: `scale(${s})`, opacity: interpolate(s, [0, 0.4], [0, 1], { extrapolateRight: "clamp" }) }}>
              {w}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ── annotate-arrow-highlight — transparent overlay over the speaker ──────────
// Use layout "full"; paints nothing but the arrow + highlight ring, so the
// speaker shows through. Point at a spot with data.x/data.y (0..1 of canvas).
export const AnnotateArrowHighlight: React.FC<
  MotionBaseProps & { x?: number; y?: number; label?: string; ring?: boolean }
> = ({ localFrame, x = 0.5, y = 0.4, label = "", ring = true }) => {
  const { fps, width, height } = useVideoConfig();
  const s = enter(localFrame, fps, 2, 16);
  const px = x * width;
  const py = y * height;
  return (
    <AbsoluteFill style={{ fontFamily: FONT, textTransform: "uppercase" }}>
      {ring ? (
        <div style={{ position: "absolute", left: px - 130, top: py - 130, width: 260, height: 260, border: `10px solid ${BRAND.accent}`, borderRadius: "50%", transform: `scale(${s})`, opacity: s, boxShadow: `0 0 40px ${BRAND.accent}66` }} />
      ) : null}
      {label ? (
        <div style={{ position: "absolute", left: px - 30, top: py + 150, transform: `translateY(${(1 - s) * 20}px)`, opacity: s, fontSize: 62, fontWeight: 800, color: BRAND.accentInk, backgroundColor: BRAND.accent, padding: "10px 26px", borderRadius: 14 }}>
          {label}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

// ── loading-to-done — a progress ring fills then flips to a check ────────────
export const LoadingToDone: React.FC<MotionBaseProps & { label?: string; doneLabel?: string }> = ({
  localFrame,
  duration,
  label = "ИИ РАБОТАЕТ...",
  doneLabel = "ГОТОВО",
}) => {
  const { fps } = useVideoConfig();
  const fillEnd = Math.max(20, duration - 18);
  const prog = interpolate(localFrame, [4, fillEnd], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const done = prog >= 0.999;
  const R = 150;
  const C = 2 * Math.PI * R;
  const pop = done ? enter(localFrame, fps, fillEnd - 2, 12) : 0;
  return (
    <Stage pad={0}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 50 }}>
        <div style={{ position: "relative", width: 360, height: 360, transform: `scale(${done ? 1 + pop * 0.06 : 1})` }}>
          <svg width={360} height={360} style={{ transform: "rotate(-90deg)" }}>
            <circle cx={180} cy={180} r={R} stroke="#1C1C22" strokeWidth={26} fill="none" />
            <circle cx={180} cy={180} r={R} stroke={BRAND.accent} strokeWidth={26} fill="none" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - prog)} />
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: done ? 150 : 92, fontWeight: 800, color: BRAND.accent }}>
            {done ? "✓" : `${Math.round(prog * 100)}`}
          </div>
        </div>
        <div style={{ fontSize: 70, fontWeight: 800, color: done ? BRAND.accent : BRAND.text }}>{done ? doneLabel : label}</div>
      </div>
    </Stage>
  );
};

// ── registry ────────────────────────────────────────────────────────────────
// Keys match brand.config.json → inserts.motionTemplates and the `template`
// field on a motion insert.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const MOTION_TEMPLATES: Record<string, React.FC<any>> = {
  "number-counter": NumberCounter,
  "vs-compare": VsCompare,
  "checklist-reveal": ChecklistReveal,
  "fake-terminal": FakeTerminal,
  "fake-dashboard-bars": FakeDashboardBars,
  "kinetic-type": KineticType,
  "annotate-arrow-highlight": AnnotateArrowHighlight,
  "loading-to-done": LoadingToDone,
};

// View wrapper: resolves the template and feeds it insert-local timing.
export const MotionInsertView: React.FC<{
  template: string;
  from: number;
  to: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: Record<string, any>;
}> = ({ template, from, to, data }) => {
  const frame = useCurrentFrame();
  const Comp = MOTION_TEMPLATES[template];
  if (!Comp) return null;
  return <Comp localFrame={frame - from} duration={to - from} {...(data ?? {})} />;
};
