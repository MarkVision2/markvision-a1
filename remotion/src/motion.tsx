import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { displayFontFamily } from "./fonts";
import { BRAND } from "./brand";

// ─────────────────────────────────────────────────────────────────────────────
// Code-based motion-graphics b-roll — premium "AI content factory" overlays.
// Each template renders on a TRANSPARENT full-canvas layer and positions its
// content in the UPPER zone, ON TOP of the speaker (no black bands, no shift;
// bottom karaoke stays clear). Receives `localFrame` (frames since the insert
// started) and `duration`.
//
// Insert usage (props inserts[]): { type:"motion", template:"number-counter",
//   from, to, data:{ value:5, suffix:"млн ₸", label:"ЗАРАБОТАЛ" } }
// ─────────────────────────────────────────────────────────────────────────────

export type MotionBaseProps = { localFrame: number; duration: number };

// Pure springy 0→1 entrance (NOT a hook — safe to call in loops).
const enter = (local: number, fps: number, delay = 0, damping = 18) =>
  spring({ frame: local - delay, fps, config: { damping, mass: 0.7 }, durationInFrames: 20 });

// Upper-zone frame: centres content horizontally, anchors near the top so the
// speaker's face (lower-centre) and the bottom captions stay visible.
const Frame: React.FC<{ children: React.ReactNode; top?: number }> = ({ children, top = 210 }) => (
  <AbsoluteFill
    style={{
      alignItems: "center",
      justifyContent: "flex-start",
      paddingTop: top,
      paddingLeft: 56,
      paddingRight: 56,
      fontFamily: displayFontFamily,
    }}
  >
    {children}
  </AbsoluteFill>
);

const glass: React.CSSProperties = {
  background: BRAND.glassBg,
  border: `1px solid ${BRAND.glassBorder}`,
  borderRadius: 30,
  boxShadow: BRAND.glassShadow,
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
};

// ── number-counter — a stat chip: key figure rolls up ────────────────────────
export const NumberCounter: React.FC<
  MotionBaseProps & { value?: number; prefix?: string; suffix?: string; label?: string; decimals?: number }
> = ({ localFrame, value = 100, prefix = "", suffix = "", label = "", decimals = 0 }) => {
  const { fps } = useVideoConfig();
  const roll = spring({ frame: localFrame, fps, config: { damping: 200 }, durationInFrames: 30 });
  const pop = enter(localFrame, fps, 0, 14);
  const shown = (value * roll).toFixed(decimals);
  return (
    <Frame>
      <div style={{ ...glass, padding: "34px 48px", transform: `translateY(${(1 - pop) * 40}px) scale(${0.9 + pop * 0.1})`, opacity: pop, textAlign: "center" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 12 }}>
          <span style={{ fontSize: 168, fontWeight: 900, lineHeight: 0.9, color: BRAND.accent, letterSpacing: "-0.02em", textShadow: `0 0 40px ${BRAND.accent}66` }}>
            {prefix}{shown}
          </span>
          {suffix ? <span style={{ fontSize: 68, fontWeight: 800, color: BRAND.text }}>{suffix}</span> : null}
        </div>
        {label ? <div style={{ marginTop: 6, fontSize: 40, fontWeight: 800, letterSpacing: "0.14em", color: BRAND.textDim, textTransform: "uppercase" }}>{label}</div> : null}
      </div>
    </Frame>
  );
};

// ── checklist-reveal — glass card, items tick in one by one ──────────────────
export const ChecklistReveal: React.FC<MotionBaseProps & { title?: string; items?: string[] }> = ({
  localFrame,
  title = "",
  items = ["Пункт один", "Пункт два", "Пункт три"],
}) => {
  const { fps } = useVideoConfig();
  const card = enter(localFrame, fps, 0, 16);
  return (
    <Frame>
      <div style={{ ...glass, padding: "30px 40px", minWidth: 620, transform: `translateY(${(1 - card) * 40}px)`, opacity: card }}>
        {title ? <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: "0.14em", color: BRAND.accent, textTransform: "uppercase", marginBottom: 22 }}>{title}</div> : null}
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {items.map((it, i) => {
            const s = enter(localFrame, fps, 6 + i * 6, 18);
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 22, opacity: s, transform: `translateX(${(1 - s) * 26}px)` }}>
                <div style={{ width: 54, height: 54, borderRadius: 14, background: BRAND.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 34, fontWeight: 900, color: BRAND.accentInk, boxShadow: `0 0 24px ${BRAND.accent}55`, transform: `scale(${s})` }}>✓</div>
                <span style={{ fontSize: 48, fontWeight: 800, color: BRAND.text }}>{it}</span>
              </div>
            );
          })}
        </div>
      </div>
    </Frame>
  );
};

// ── fake-terminal — floating glass terminal, code types out ──────────────────
export const FakeTerminal: React.FC<MotionBaseProps & { title?: string; lines?: string[] }> = ({
  localFrame,
  title = "claude code",
  lines = ["$ ai automate --task inbox", "→ анализирую письма...", "→ пишу ответы...", "✓ готово за 4 сек"],
}) => {
  const { fps } = useVideoConfig();
  const card = enter(localFrame, fps, 0, 16);
  const perLine = 16;
  return (
    <Frame top={230}>
      <div style={{ ...glass, width: 720, padding: 0, overflow: "hidden", transform: `translateY(${(1 - card) * 40}px) scale(${0.94 + card * 0.06})`, opacity: card, fontFamily: "'SF Mono','JetBrains Mono',ui-monospace,monospace" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "18px 24px", borderBottom: `1px solid ${BRAND.glassBorder}` }}>
          {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => <div key={c} style={{ width: 18, height: 18, borderRadius: "50%", background: c }} />)}
          <span style={{ marginLeft: 8, fontSize: 26, color: BRAND.textDim, letterSpacing: "0.06em" }}>{title}</span>
        </div>
        <div style={{ padding: "24px 28px" }}>
          {lines.map((ln, i) => {
            const start = i * perLine;
            if (localFrame < start) return <div key={i} style={{ height: 46 }} />;
            const chars = Math.floor((localFrame - start) * 2.4);
            const text = ln.slice(0, chars);
            const typing = chars < ln.length;
            const done = ln.startsWith("✓");
            return (
              <div key={i} style={{ fontSize: 32, lineHeight: 1.45, color: done ? BRAND.accent : BRAND.text, fontWeight: 500 }}>
                {text}{typing && Math.floor(localFrame / 8) % 2 === 0 ? <span style={{ color: BRAND.accent }}>▋</span> : null}
              </div>
            );
          })}
        </div>
      </div>
    </Frame>
  );
};

// ── fake-dashboard-bars — glass card, metric bars grow ───────────────────────
export const FakeDashboardBars: React.FC<
  MotionBaseProps & { title?: string; bars?: { label: string; value: number }[] }
> = ({ localFrame, title = "РЕЗУЛЬТАТ", bars = [{ label: "До", value: 30 }, { label: "После", value: 92 }] }) => {
  const { fps } = useVideoConfig();
  const card = enter(localFrame, fps, 0, 16);
  const max = Math.max(...bars.map((b) => b.value), 1);
  return (
    <Frame>
      <div style={{ ...glass, padding: "30px 40px", width: 720, transform: `translateY(${(1 - card) * 40}px)`, opacity: card }}>
        <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: "0.14em", color: BRAND.accent, textTransform: "uppercase", marginBottom: 24 }}>{title}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
          {bars.map((b, i) => {
            const g = spring({ frame: localFrame - 8 - i * 8, fps, config: { damping: 200 }, durationInFrames: 28 });
            const last = i === bars.length - 1;
            return (
              <div key={i}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 34, fontWeight: 800, marginBottom: 10 }}>
                  <span style={{ color: BRAND.textDim }}>{b.label}</span>
                  <span style={{ color: last ? BRAND.accent : BRAND.text }}>{Math.round(b.value * g)}%</span>
                </div>
                <div style={{ height: 40, borderRadius: 12, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${(b.value / max) * 100 * g}%`, background: last ? BRAND.accent : "rgba(255,255,255,0.35)", borderRadius: 12, boxShadow: last ? `0 0 24px ${BRAND.accent}66` : "none" }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Frame>
  );
};

// ── kinetic-type — a punchy phrase stamps in word by word ────────────────────
export const KineticType: React.FC<MotionBaseProps & { words?: string[]; accentIndex?: number }> = ({
  localFrame,
  words = ["АВТОМАТИЗИРУЙ", "ВСЁ", "СЕЙЧАС"],
  accentIndex = 1,
}) => {
  const { fps } = useVideoConfig();
  return (
    <Frame top={190}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        {words.map((w, i) => {
          const s = spring({ frame: localFrame - i * 6, fps, config: { damping: 13, mass: 0.6 }, durationInFrames: 18 });
          const acc = i === accentIndex;
          return (
            <div key={i} style={{ fontSize: acc ? 128 : 100, fontWeight: 900, lineHeight: 0.98, color: acc ? BRAND.accentInk : BRAND.text, background: acc ? BRAND.accent : "transparent", padding: acc ? "2px 24px" : 0, borderRadius: 16, boxShadow: acc ? `0 12px 40px ${BRAND.accent}55` : "none", textShadow: acc ? "none" : "0 6px 30px rgba(0,0,0,0.65)", transform: `scale(${s})`, opacity: interpolate(s, [0, 0.4], [0, 1], { extrapolateRight: "clamp" }) }}>
              {w}
            </div>
          );
        })}
      </div>
    </Frame>
  );
};

// ── annotate-arrow-highlight — transparent ring + label over the speaker ─────
export const AnnotateArrowHighlight: React.FC<
  MotionBaseProps & { x?: number; y?: number; label?: string; ring?: boolean }
> = ({ localFrame, x = 0.5, y = 0.42, label = "", ring = true }) => {
  const { fps, width, height } = useVideoConfig();
  const s = enter(localFrame, fps, 2, 15);
  const px = x * width;
  const py = y * height;
  return (
    <AbsoluteFill style={{ fontFamily: displayFontFamily }}>
      {ring ? <div style={{ position: "absolute", left: px - 130, top: py - 130, width: 260, height: 260, border: `10px solid ${BRAND.accent}`, borderRadius: "50%", transform: `scale(${s})`, opacity: s, boxShadow: `0 0 40px ${BRAND.accent}66` }} /> : null}
      {label ? <div style={{ position: "absolute", left: px - 40, top: py + 150, transform: `translateY(${(1 - s) * 20}px)`, opacity: s, fontSize: 54, fontWeight: 900, color: BRAND.accentInk, background: BRAND.accent, padding: "10px 26px", borderRadius: 14, boxShadow: `0 0 30px ${BRAND.accent}66` }}>{label}</div> : null}
    </AbsoluteFill>
  );
};

// ── loading-to-done — compact glass ring chip ────────────────────────────────
export const LoadingToDone: React.FC<MotionBaseProps & { label?: string; doneLabel?: string }> = ({
  localFrame,
  duration,
  label = "ИИ РАБОТАЕТ...",
  doneLabel = "ГОТОВО",
}) => {
  const { fps } = useVideoConfig();
  const card = enter(localFrame, fps, 0, 16);
  const fillEnd = Math.max(20, duration - 16);
  const prog = interpolate(localFrame, [4, fillEnd], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const done = prog >= 0.999;
  const R = 90, C = 2 * Math.PI * 90;
  return (
    <Frame>
      <div style={{ ...glass, padding: "28px 40px", display: "flex", alignItems: "center", gap: 28, transform: `translateY(${(1 - card) * 40}px)`, opacity: card }}>
        <div style={{ position: "relative", width: 200, height: 200 }}>
          <svg width={200} height={200} style={{ transform: "rotate(-90deg)" }}>
            <circle cx={100} cy={100} r={R} stroke="rgba(255,255,255,0.12)" strokeWidth={18} fill="none" />
            <circle cx={100} cy={100} r={R} stroke={BRAND.accent} strokeWidth={18} fill="none" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - prog)} />
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: done ? 90 : 56, fontWeight: 900, color: BRAND.accent }}>{done ? "✓" : Math.round(prog * 100)}</div>
        </div>
        <div style={{ fontSize: 46, fontWeight: 800, color: done ? BRAND.accent : BRAND.text }}>{done ? doneLabel : label}</div>
      </div>
    </Frame>
  );
};

// ── vs-compare — two compact glass columns ───────────────────────────────────
export const VsCompare: React.FC<
  MotionBaseProps & { leftTitle?: string; rightTitle?: string; leftItems?: string[]; rightItems?: string[] }
> = ({ localFrame, leftTitle = "ВРУЧНУЮ", rightTitle = "С ИИ", leftItems = ["Медленно", "Дорого"], rightItems = ["Быстро", "Дёшево"] }) => {
  const { fps } = useVideoConfig();
  const card = enter(localFrame, fps, 0, 16);
  const Col: React.FC<{ title: string; items: string[]; good: boolean }> = ({ title, items, good }) => (
    <div style={{ ...glass, flex: 1, padding: "24px 28px" }}>
      <div style={{ fontSize: 40, fontWeight: 900, textAlign: "center", marginBottom: 18, color: good ? BRAND.accent : BRAND.textDim }}>{title}</div>
      {items.map((it, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 38, fontWeight: 800, marginTop: 12, color: good ? BRAND.text : BRAND.textDim }}>
          <span style={{ color: good ? BRAND.accent : "#5A6070" }}>{good ? "✓" : "✕"}</span>{it}
        </div>
      ))}
    </div>
  );
  return (
    <Frame>
      <div style={{ display: "flex", gap: 24, width: 800, transform: `translateY(${(1 - card) * 40}px)`, opacity: card }}>
        <Col title={leftTitle} items={leftItems} good={false} />
        <Col title={rightTitle} items={rightItems} good />
      </div>
    </Frame>
  );
};

// ── registry ─────────────────────────────────────────────────────────────────
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
