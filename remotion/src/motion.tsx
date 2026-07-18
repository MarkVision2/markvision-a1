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
// Transparent full-canvas layer, content in the UPPER zone over the speaker
// (no black bands, no shift). Each insert can carry its own accent colour
// (data.accent) and icons (data.icon / data.icons) for visual variety.
//   { type:"motion", template:"number-counter", from, to,
//     data:{ value:5, suffix:"млн ₸", label:"ЗАРАБОТАЛ", accent:"#34D399",
//            icon:"coin", cover:true } }
// ─────────────────────────────────────────────────────────────────────────────

export type MotionBaseProps = { localFrame: number; duration: number };

// Curated accent palette (all read well over live footage).
export const PALETTE = {
  orange: "#FF7A18",
  cyan: "#22D3EE",
  violet: "#8B5CF6",
  emerald: "#34D399",
  amber: "#FFC53D",
  rose: "#FB7185",
  blue: "#3B82F6",
} as const;

const enter = (local: number, fps: number, delay = 0, damping = 18) =>
  spring({ frame: local - delay, fps, config: { damping, mass: 0.7 }, durationInFrames: 20 });

const Frame: React.FC<{ children: React.ReactNode; top?: number; center?: boolean }> = ({
  children,
  top = 210,
  center = false,
}) => (
  <AbsoluteFill
    style={{
      alignItems: "center",
      justifyContent: center ? "center" : "flex-start",
      paddingTop: center ? 0 : top,
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

// ── inline line-icons (no assets; stroke = currentColor) ─────────────────────
const ICONS: Record<string, React.ReactNode> = {
  check: <polyline points="20 6 9 17 4 12" />,
  layers: (
    <>
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </>
  ),
  apps: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />
    </>
  ),
  award: (
    <>
      <circle cx="12" cy="9" r="6" />
      <polyline points="8 14 7 22 12 19 17 22 16 14" />
    </>
  ),
  coin: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4" />
    </>
  ),
  code: (
    <>
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </>
  ),
  bolt: <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
  fire: <path d="M12 2c1 4 4 5 4 9a4 4 0 0 1-8 0c0-2 1-3 1-3 0 2 1 3 2 3 1 0 1-2 0-4-1-2-1-4 1-5z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 16 14" />
    </>
  ),
  chart: (
    <>
      <line x1="6" y1="20" x2="6" y2="12" />
      <line x1="12" y1="20" x2="12" y2="5" />
      <line x1="18" y1="20" x2="18" y2="14" />
    </>
  ),
  rocket: <path d="M5 15c-1 2-1 5-1 5s3 0 5-1M12 3c4 2 7 6 7 10l-4 4H9l-4-4c0-4 3-8 7-10zM12 12a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4z" />,
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" />
    </>
  ),
};

const Icon: React.FC<{ name: string; size?: number; color?: string }> = ({ name, size = 30, color = "currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    {ICONS[name] ?? ICONS.check}
  </svg>
);

// Rounded icon tile (accent-tinted), like the reference step cards.
const IconTile: React.FC<{ name: string; accent: string; s?: number }> = ({ name, accent, s = 1 }) => (
  <div style={{ width: 62, height: 62, borderRadius: 16, background: `${accent}26`, border: `1px solid ${accent}55`, display: "flex", alignItems: "center", justifyContent: "center", color: accent, boxShadow: `0 0 22px ${accent}33`, transform: `scale(${s})`, flexShrink: 0 }}>
    <Icon name={name} size={32} />
  </div>
);

// ── number-counter — a stat chip: key figure rolls up ────────────────────────
export const NumberCounter: React.FC<
  MotionBaseProps & { value?: number; prefix?: string; suffix?: string; label?: string; decimals?: number; accent?: string; icon?: string; cover?: boolean }
> = ({ localFrame, value = 100, prefix = "", suffix = "", label = "", decimals = 0, accent = BRAND.accent, icon, cover = false }) => {
  const { fps } = useVideoConfig();
  const roll = spring({ frame: localFrame, fps, config: { damping: 200 }, durationInFrames: 30 });
  const pop = enter(localFrame, fps, 0, 14);
  const shown = (value * roll).toFixed(decimals);
  return (
    <Frame center={cover}>
      <div style={{ ...glass, padding: "34px 48px", transform: `translateY(${(1 - pop) * 40}px) scale(${0.9 + pop * 0.1})`, opacity: pop, textAlign: "center" }}>
        {icon ? (
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
            <IconTile name={icon} accent={accent} s={pop} />
          </div>
        ) : null}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 12 }}>
          <span style={{ fontSize: 168, fontWeight: 900, lineHeight: 0.9, color: accent, letterSpacing: "-0.02em", textShadow: `0 0 40px ${accent}66` }}>
            {prefix}{shown}
          </span>
          {suffix ? <span style={{ fontSize: 68, fontWeight: 800, color: BRAND.text }}>{suffix}</span> : null}
        </div>
        {label ? <div style={{ marginTop: 6, fontSize: 40, fontWeight: 800, letterSpacing: "0.14em", color: BRAND.textDim, textTransform: "uppercase" }}>{label}</div> : null}
      </div>
    </Frame>
  );
};

// ── checklist-reveal — glass card, icon tiles tick in one by one ─────────────
export const ChecklistReveal: React.FC<
  MotionBaseProps & { title?: string; items?: string[]; icons?: string[]; accent?: string; cover?: boolean }
> = ({ localFrame, title = "", items = ["Пункт один", "Пункт два", "Пункт три"], icons = [], accent = BRAND.accent, cover = false }) => {
  const { fps } = useVideoConfig();
  const card = enter(localFrame, fps, 0, 16);
  return (
    <Frame center={cover}>
      <div style={{ ...glass, padding: "30px 40px", minWidth: 620, borderLeft: `5px solid ${accent}`, transform: `translateY(${(1 - card) * 40}px)`, opacity: card }}>
        {title ? <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: "0.14em", color: accent, textTransform: "uppercase", marginBottom: 22 }}>{title}</div> : null}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {items.map((it, i) => {
            const s = enter(localFrame, fps, 6 + i * 6, 18);
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 22, opacity: s, transform: `translateX(${(1 - s) * 26}px)` }}>
                <IconTile name={icons[i] ?? "check"} accent={accent} s={s} />
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
export const FakeTerminal: React.FC<MotionBaseProps & { title?: string; lines?: string[]; accent?: string; cover?: boolean }> = ({
  localFrame,
  title = "claude code",
  lines = ["$ ai automate --task inbox", "→ анализирую письма...", "→ пишу ответы...", "✓ готово за 4 сек"],
  accent = BRAND.accent,
  cover = false,
}) => {
  const { fps } = useVideoConfig();
  const card = enter(localFrame, fps, 0, 16);
  const perLine = 16;
  return (
    <Frame top={230} center={cover}>
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
              <div key={i} style={{ fontSize: 32, lineHeight: 1.45, color: done ? accent : BRAND.text, fontWeight: 500 }}>
                {text}{typing && Math.floor(localFrame / 8) % 2 === 0 ? <span style={{ color: accent }}>▋</span> : null}
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
  MotionBaseProps & { title?: string; bars?: { label: string; value: number }[]; accent?: string; cover?: boolean }
> = ({ localFrame, title = "РЕЗУЛЬТАТ", bars = [{ label: "До", value: 30 }, { label: "После", value: 92 }], accent = BRAND.accent, cover = false }) => {
  const { fps } = useVideoConfig();
  const card = enter(localFrame, fps, 0, 16);
  const max = Math.max(...bars.map((b) => b.value), 1);
  return (
    <Frame center={cover}>
      <div style={{ ...glass, padding: "30px 40px", width: 720, borderLeft: `5px solid ${accent}`, transform: `translateY(${(1 - card) * 40}px)`, opacity: card }}>
        <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: "0.14em", color: accent, textTransform: "uppercase", marginBottom: 24 }}>{title}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
          {bars.map((b, i) => {
            const g = spring({ frame: localFrame - 8 - i * 8, fps, config: { damping: 200 }, durationInFrames: 28 });
            const last = i === bars.length - 1;
            return (
              <div key={i}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 34, fontWeight: 800, marginBottom: 10 }}>
                  <span style={{ color: BRAND.textDim }}>{b.label}</span>
                  <span style={{ color: last ? accent : BRAND.text }}>{Math.round(b.value * g)}%</span>
                </div>
                <div style={{ height: 40, borderRadius: 12, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${(b.value / max) * 100 * g}%`, background: last ? accent : "rgba(255,255,255,0.35)", borderRadius: 12, boxShadow: last ? `0 0 24px ${accent}66` : "none" }} />
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
export const KineticType: React.FC<MotionBaseProps & { words?: string[]; accentIndex?: number; accent?: string; icon?: string; cover?: boolean }> = ({
  localFrame,
  words = ["АВТОМАТИЗИРУЙ", "ВСЁ", "СЕЙЧАС"],
  accentIndex = 1,
  accent = BRAND.accent,
  icon,
  cover = false,
}) => {
  const { fps } = useVideoConfig();
  const pop = enter(localFrame, fps, 0, 14);
  return (
    <Frame top={190} center={cover}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, maxWidth: "100%" }}>
        {icon ? <div style={{ marginBottom: 10 }}><IconTile name={icon} accent={accent} s={pop} /></div> : null}
        {words.map((w, i) => {
          const s = spring({ frame: localFrame - i * 6, fps, config: { damping: 13, mass: 0.6 }, durationInFrames: 18 });
          const acc = i === accentIndex;
          const base = acc ? 118 : 94;
          // shrink long words so the (padded) pill never exceeds the 1080 canvas.
          // Montserrat 900 uppercase ≈ 0.85em/glyph; accent word has pill padding,
          // so it gets a smaller width budget. Guarantees no right-edge clipping.
          const budget = acc ? 800 : 880;
          const fs = Math.min(base, Math.floor(budget / (Math.max(w.length, 1) * 0.85)));
          return (
            <div key={i} style={{ fontSize: fs, fontWeight: 900, lineHeight: 1.0, whiteSpace: "nowrap", maxWidth: "100%", color: acc ? BRAND.accentInk : BRAND.text, background: acc ? accent : "transparent", padding: acc ? "4px 24px" : 0, borderRadius: 16, boxShadow: acc ? `0 12px 40px ${accent}55` : "none", textShadow: acc ? "none" : "0 6px 30px rgba(0,0,0,0.65)", transform: `scale(${s})`, opacity: interpolate(s, [0, 0.4], [0, 1], { extrapolateRight: "clamp" }) }}>
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
  MotionBaseProps & { x?: number; y?: number; label?: string; ring?: boolean; accent?: string }
> = ({ localFrame, x = 0.5, y = 0.42, label = "", ring = true, accent = BRAND.accent }) => {
  const { fps, width, height } = useVideoConfig();
  const s = enter(localFrame, fps, 2, 15);
  const px = x * width;
  const py = y * height;
  return (
    <AbsoluteFill style={{ fontFamily: displayFontFamily }}>
      {ring ? <div style={{ position: "absolute", left: px - 130, top: py - 130, width: 260, height: 260, border: `10px solid ${accent}`, borderRadius: "50%", transform: `scale(${s})`, opacity: s, boxShadow: `0 0 40px ${accent}66` }} /> : null}
      {label ? <div style={{ position: "absolute", left: px - 40, top: py + 150, transform: `translateY(${(1 - s) * 20}px)`, opacity: s, fontSize: 54, fontWeight: 900, color: BRAND.accentInk, background: accent, padding: "10px 26px", borderRadius: 14, boxShadow: `0 0 30px ${accent}66` }}>{label}</div> : null}
    </AbsoluteFill>
  );
};

// ── loading-to-done — compact glass ring chip ────────────────────────────────
export const LoadingToDone: React.FC<MotionBaseProps & { label?: string; doneLabel?: string; accent?: string }> = ({
  localFrame,
  duration,
  label = "ИИ РАБОТАЕТ...",
  doneLabel = "ГОТОВО",
  accent = BRAND.accent,
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
            <circle cx={100} cy={100} r={R} stroke={accent} strokeWidth={18} fill="none" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - prog)} />
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: done ? 90 : 56, fontWeight: 900, color: accent }}>{done ? "✓" : Math.round(prog * 100)}</div>
        </div>
        <div style={{ fontSize: 46, fontWeight: 800, color: done ? accent : BRAND.text }}>{done ? doneLabel : label}</div>
      </div>
    </Frame>
  );
};

// ── vs-compare — two compact glass columns ───────────────────────────────────
export const VsCompare: React.FC<
  MotionBaseProps & { leftTitle?: string; rightTitle?: string; leftItems?: string[]; rightItems?: string[]; accent?: string }
> = ({ localFrame, leftTitle = "ВРУЧНУЮ", rightTitle = "С ИИ", leftItems = ["Медленно", "Дорого"], rightItems = ["Быстро", "Дёшево"], accent = BRAND.accent }) => {
  const { fps } = useVideoConfig();
  const card = enter(localFrame, fps, 0, 16);
  const Col: React.FC<{ title: string; items: string[]; good: boolean }> = ({ title, items, good }) => (
    <div style={{ ...glass, flex: 1, padding: "24px 28px", borderTop: good ? `5px solid ${accent}` : "5px solid rgba(255,255,255,0.15)" }}>
      <div style={{ fontSize: 40, fontWeight: 900, textAlign: "center", marginBottom: 18, color: good ? accent : BRAND.textDim }}>{title}</div>
      {items.map((it, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 38, fontWeight: 800, marginTop: 12, color: good ? BRAND.text : BRAND.textDim }}>
          <span style={{ color: good ? accent : "#5A6070" }}>{good ? "✓" : "✕"}</span>{it}
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

// ── stat-grid — a row of icon + big-number tiles (multiple stats/benefits) ───
export const StatGrid: React.FC<
  MotionBaseProps & { items?: { icon?: string; value: string; label: string }[]; accent?: string; cover?: boolean }
> = ({ localFrame, items = [{ value: "10x", label: "Быстрее" }, { value: "0₽", label: "Дизайнер" }], accent = BRAND.accent, cover = false }) => {
  const { fps } = useVideoConfig();
  return (
    <Frame center={cover}>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", justifyContent: "center", maxWidth: 940 }}>
        {items.map((it, i) => {
          const s = enter(localFrame, fps, i * 6, 16);
          return (
            <div key={i} style={{ ...glass, padding: "26px 32px", minWidth: 250, textAlign: "center", transform: `translateY(${(1 - s) * 30}px) scale(${0.9 + s * 0.1})`, opacity: s }}>
              {it.icon ? <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}><IconTile name={it.icon} accent={accent} s={s} /></div> : null}
              <div style={{ fontSize: 84, fontWeight: 900, color: accent, lineHeight: 1, textShadow: `0 0 30px ${accent}55` }}>{it.value}</div>
              <div style={{ fontSize: 32, fontWeight: 800, color: BRAND.textDim, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 4 }}>{it.label}</div>
            </div>
          );
        })}
      </div>
    </Frame>
  );
};

// ── timeline-steps — numbered steps (process / "как это работает") ────────────
export const TimelineSteps: React.FC<MotionBaseProps & { steps?: string[]; accent?: string; cover?: boolean }> = ({
  localFrame,
  steps = ["Диктуешь идею", "ИИ пишет код", "Готовый ролик"],
  accent = BRAND.accent,
  cover = false,
}) => {
  const { fps } = useVideoConfig();
  return (
    <Frame center={cover}>
      <div style={{ ...glass, padding: "34px 42px", minWidth: 660 }}>
        {steps.map((st, i) => {
          const s = enter(localFrame, fps, i * 8, 16);
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 22, marginTop: i ? 26 : 0, opacity: s, transform: `translateX(${(1 - s) * 26}px)` }}>
              <div style={{ width: 62, height: 62, borderRadius: "50%", background: accent, color: BRAND.accentInk, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 34, fontWeight: 900, boxShadow: `0 0 22px ${accent}55`, flexShrink: 0 }}>{i + 1}</div>
              <span style={{ fontSize: 46, fontWeight: 800, color: BRAND.text }}>{st}</span>
            </div>
          );
        })}
      </div>
    </Frame>
  );
};

// ── quote-card — a big quoted statement (hook / key claim) ────────────────────
export const QuoteCard: React.FC<MotionBaseProps & { text?: string; accent?: string; cover?: boolean }> = ({
  localFrame,
  text = "",
  accent = BRAND.accent,
  cover = false,
}) => {
  const { fps } = useVideoConfig();
  const s = enter(localFrame, fps, 0, 16);
  return (
    <Frame center={cover}>
      <div style={{ ...glass, padding: "38px 48px", maxWidth: 840, borderLeft: `6px solid ${accent}`, transform: `translateY(${(1 - s) * 40}px)`, opacity: s }}>
        <div style={{ fontSize: 90, fontWeight: 900, color: accent, lineHeight: 0.5, marginBottom: 10 }}>“</div>
        <div style={{ fontSize: 54, fontWeight: 800, color: BRAND.text, lineHeight: 1.12, textTransform: "uppercase" }}>{text}</div>
      </div>
    </Frame>
  );
};

// ── big-statement — full-screen headline + underline (hook / CTA) ────────────
export const BigStatement: React.FC<MotionBaseProps & { lines?: string[]; accent?: string; cover?: boolean }> = ({
  localFrame,
  lines = ["БОЛЬШОЕ", "ЗАЯВЛЕНИЕ"],
  accent = BRAND.accent,
  cover = false,
}) => {
  const { fps } = useVideoConfig();
  return (
    <Frame center={cover}>
      <div style={{ maxWidth: 940, width: "100%", textAlign: "center", overflow: "hidden" }}>
        {lines.map((ln, i) => {
          const s = enter(localFrame, fps, i * 5, 13);
          // Montserrat 900 uppercase ≈ 0.85em/char; size each line so the whole
          // word always fits the 9:16 frame (no right-edge clipping).
          const fs = Math.min(120, Math.floor(900 / (Math.max(ln.length, 1) * 0.85)));
          return (
            <div key={i} style={{ fontSize: fs, fontWeight: 900, whiteSpace: "nowrap", color: i === lines.length - 1 ? accent : BRAND.text, lineHeight: 1.06, textTransform: "uppercase", transform: `translateY(${(1 - s) * 30}px) scale(${0.9 + s * 0.1})`, opacity: s, textShadow: "0 6px 30px rgba(0,0,0,0.6)" }}>{ln}</div>
          );
        })}
        <div style={{ height: 10, width: `${enter(localFrame, fps, lines.length * 5, 16) * 66}%`, background: accent, margin: "20px auto 0", borderRadius: 6, boxShadow: `0 0 24px ${accent}66` }} />
      </div>
    </Frame>
  );
};

// ── lower-third — name/role chip, lower-left (speaker intro) ──────────────────
export const LowerThird: React.FC<MotionBaseProps & { name?: string; role?: string; accent?: string; icon?: string }> = ({
  localFrame,
  name = "ЮРИЙ",
  role = "IT-предприниматель",
  accent = BRAND.accent,
  icon,
}) => {
  const { fps } = useVideoConfig();
  const s = enter(localFrame, fps, 0, 15);
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "flex-start", padding: "0 0 300px 60px", fontFamily: displayFontFamily }}>
      <div style={{ ...glass, padding: "20px 30px", display: "flex", alignItems: "center", gap: 18, borderLeft: `5px solid ${accent}`, transform: `translateX(${(1 - s) * -40}px)`, opacity: s }}>
        {icon ? <IconTile name={icon} accent={accent} s={s} /> : null}
        <div>
          <div style={{ fontSize: 56, fontWeight: 900, color: BRAND.text, textTransform: "uppercase" }}>{name}</div>
          <div style={{ fontSize: 30, fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: "0.06em" }}>{role}</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── pill-row — row of keyword/tool pills ─────────────────────────────────────
export const PillRow: React.FC<MotionBaseProps & { items?: string[]; accent?: string; cover?: boolean }> = ({
  localFrame,
  items = ["ChatGPT", "Claude", "Midjourney"],
  accent = BRAND.accent,
  cover = false,
}) => {
  const { fps } = useVideoConfig();
  return (
    <Frame center={cover}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 18, justifyContent: "center", maxWidth: 900 }}>
        {items.map((it, i) => {
          const s = enter(localFrame, fps, i * 5, 14);
          return <div key={i} style={{ ...glass, padding: "16px 34px", fontSize: 46, fontWeight: 800, color: BRAND.text, border: `2px solid ${accent}`, borderRadius: 100, transform: `scale(${0.7 + s * 0.3})`, opacity: s }}>{it}</div>;
        })}
      </div>
    </Frame>
  );
};

// ── metric-callout — one big KPI with a delta arrow ──────────────────────────
export const MetricCallout: React.FC<MotionBaseProps & { value?: string; label?: string; up?: boolean; accent?: string; cover?: boolean }> = ({
  localFrame,
  value = "+300%",
  label = "",
  up = true,
  accent = BRAND.accent,
  cover = false,
}) => {
  const { fps } = useVideoConfig();
  const s = enter(localFrame, fps, 0, 14);
  return (
    <Frame center={cover}>
      <div style={{ ...glass, padding: "34px 48px", textAlign: "center", transform: `translateY(${(1 - s) * 40}px) scale(${0.9 + s * 0.1})`, opacity: s }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14 }}>
          <span style={{ fontSize: 150, fontWeight: 900, color: accent, textShadow: `0 0 40px ${accent}66` }}>{value}</span>
          <span style={{ fontSize: 90, color: up ? accent : BRAND.textDim }}>{up ? "▲" : "▼"}</span>
        </div>
        {label ? <div style={{ fontSize: 38, fontWeight: 800, color: BRAND.textDim, textTransform: "uppercase", letterSpacing: "0.1em" }}>{label}</div> : null}
      </div>
    </Frame>
  );
};

// ── phone-mockup — a phone frame showing an app UI ───────────────────────────
export const PhoneMockup: React.FC<MotionBaseProps & { title?: string; lines?: string[]; accent?: string; cover?: boolean }> = ({
  localFrame,
  title = "APP",
  lines = ["Главная", "Профиль", "Настройки"],
  accent = BRAND.accent,
  cover = false,
}) => {
  const { fps } = useVideoConfig();
  const s = enter(localFrame, fps, 0, 15);
  return (
    <Frame center={cover}>
      <div style={{ width: 380, height: 760, borderRadius: 52, background: "#0E121C", border: `3px solid ${BRAND.glassBorder}`, boxShadow: BRAND.glassShadow, padding: 20, transform: `translateY(${(1 - s) * 50}px) scale(${0.9 + s * 0.1})`, opacity: s, overflow: "hidden" }}>
        <div style={{ height: 60, background: accent, borderRadius: "20px 20px 6px 6px", display: "flex", alignItems: "center", justifyContent: "center", color: BRAND.accentInk, fontWeight: 900, fontSize: 34, fontFamily: displayFontFamily }}>{title}</div>
        {lines.map((ln, i) => {
          const ls = enter(localFrame, fps, 10 + i * 7, 16);
          return <div key={i} style={{ marginTop: 16, height: 70, background: "rgba(255,255,255,0.06)", borderRadius: 14, display: "flex", alignItems: "center", padding: "0 20px", fontSize: 34, fontWeight: 700, color: BRAND.text, opacity: ls, transform: `translateX(${(1 - ls) * 20}px)` }}>{ln}</div>;
        })}
      </div>
    </Frame>
  );
};

// ── chat-bubbles — messenger dialog (prompt → AI answer) ──────────────────────
export const ChatBubbles: React.FC<MotionBaseProps & { messages?: { from: "user" | "ai"; text: string }[]; accent?: string; cover?: boolean }> = ({
  localFrame,
  messages = [{ from: "user", text: "Собери мне лендинг" }, { from: "ai", text: "Готово ✅" }],
  accent = BRAND.accent,
  cover = false,
}) => {
  const { fps } = useVideoConfig();
  return (
    <Frame center={cover}>
      <div style={{ display: "flex", flexDirection: "column", gap: 18, width: 720 }}>
        {messages.map((m, i) => {
          const s = enter(localFrame, fps, i * 12, 15);
          const ai = m.from === "ai";
          return <div key={i} style={{ alignSelf: ai ? "flex-end" : "flex-start", maxWidth: "82%", padding: "20px 28px", borderRadius: 26, fontSize: 40, fontWeight: 700, color: ai ? BRAND.accentInk : BRAND.text, background: ai ? accent : "rgba(255,255,255,0.1)", opacity: s, transform: `translateY(${(1 - s) * 20}px)` }}>{m.text}</div>;
        })}
      </div>
    </Frame>
  );
};

// ── notification-toast — a toast popup from the top ──────────────────────────
export const NotificationToast: React.FC<MotionBaseProps & { title?: string; text?: string; accent?: string; icon?: string }> = ({
  localFrame,
  title = "Уведомление",
  text = "",
  accent = BRAND.accent,
  icon = "bolt",
}) => {
  const { fps } = useVideoConfig();
  const s = enter(localFrame, fps, 0, 15);
  return (
    <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: 200, fontFamily: displayFontFamily }}>
      <div style={{ ...glass, padding: "22px 30px", display: "flex", alignItems: "center", gap: 18, width: 760, transform: `translateY(${(1 - s) * -60}px)`, opacity: s }}>
        <IconTile name={icon} accent={accent} s={s} />
        <div>
          <div style={{ fontSize: 40, fontWeight: 900, color: BRAND.text }}>{title}</div>
          {text ? <div style={{ fontSize: 30, fontWeight: 600, color: BRAND.textDim }}>{text}</div> : null}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── rating-stars — star rating (reviews / social proof) ──────────────────────
export const RatingStars: React.FC<MotionBaseProps & { rating?: number; label?: string; accent?: string; cover?: boolean }> = ({
  localFrame,
  rating = 5,
  label = "",
  accent = "#FFC53D",
  cover = false,
}) => {
  const { fps } = useVideoConfig();
  return (
    <Frame center={cover}>
      <div style={{ ...glass, padding: "30px 44px", textAlign: "center" }}>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          {Array.from({ length: 5 }).map((_, i) => {
            const s = enter(localFrame, fps, i * 6, 14);
            const on = i < rating;
            return <span key={i} style={{ fontSize: 80, color: on ? accent : "rgba(255,255,255,0.15)", transform: `scale(${s})`, textShadow: on ? `0 0 24px ${accent}66` : "none" }}>★</span>;
          })}
        </div>
        {label ? <div style={{ marginTop: 12, fontSize: 40, fontWeight: 800, color: BRAND.text, textTransform: "uppercase" }}>{label}</div> : null}
      </div>
    </Frame>
  );
};

// ── countdown — a number ticking down (urgency) ──────────────────────────────
export const Countdown: React.FC<MotionBaseProps & { from?: number; label?: string; accent?: string; cover?: boolean }> = ({
  localFrame,
  from = 3,
  label = "ОСТАЛОСЬ",
  accent = "#FB7185",
  cover = false,
}) => {
  const { fps } = useVideoConfig();
  const s = enter(localFrame, fps, 0, 14);
  const n = Math.max(0, from - Math.floor(localFrame / fps));
  return (
    <Frame center={cover}>
      <div style={{ ...glass, padding: "34px 60px", textAlign: "center", transform: `scale(${0.9 + s * 0.1})`, opacity: s }}>
        <div style={{ fontSize: 200, fontWeight: 900, color: accent, lineHeight: 1, textShadow: `0 0 40px ${accent}66` }}>{n}</div>
        {label ? <div style={{ fontSize: 36, fontWeight: 800, color: BRAND.textDim, textTransform: "uppercase", letterSpacing: "0.14em" }}>{label}</div> : null}
      </div>
    </Frame>
  );
};

// ── gauge — semicircle meter (score / level) ─────────────────────────────────
export const Gauge: React.FC<MotionBaseProps & { value?: number; label?: string; accent?: string; cover?: boolean }> = ({
  localFrame,
  value = 80,
  label = "",
  accent = BRAND.accent,
  cover = false,
}) => {
  const { fps } = useVideoConfig();
  const g = spring({ frame: localFrame, fps, config: { damping: 200 }, durationInFrames: 30 });
  const R = 150;
  const C = Math.PI * R;
  const p = (value / 100) * g;
  return (
    <Frame center={cover}>
      <div style={{ ...glass, padding: "40px 50px 30px", textAlign: "center" }}>
        <svg width={380} height={210} viewBox="0 0 380 210">
          <path d="M40 190 A150 150 0 0 1 340 190" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={26} strokeLinecap="round" />
          <path d="M40 190 A150 150 0 0 1 340 190" fill="none" stroke={accent} strokeWidth={26} strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - p)} />
        </svg>
        <div style={{ fontSize: 96, fontWeight: 900, color: accent, marginTop: -40 }}>{Math.round(value * g)}<span style={{ fontSize: 50 }}>%</span></div>
        {label ? <div style={{ fontSize: 34, fontWeight: 800, color: BRAND.textDim, textTransform: "uppercase" }}>{label}</div> : null}
      </div>
    </Frame>
  );
};

// ── arrow-flow — A → B → C flow ──────────────────────────────────────────────
export const ArrowFlow: React.FC<MotionBaseProps & { steps?: string[]; accent?: string; cover?: boolean }> = ({
  localFrame,
  steps = ["Идея", "ИИ", "Результат"],
  accent = BRAND.accent,
  cover = false,
}) => {
  const { fps } = useVideoConfig();
  return (
    <Frame center={cover}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", justifyContent: "center", maxWidth: 960 }}>
        {steps.map((st, i) => (
          <React.Fragment key={i}>
            <div style={{ ...glass, padding: "22px 30px", fontSize: 44, fontWeight: 800, color: BRAND.text, opacity: enter(localFrame, fps, i * 8, 15), transform: `scale(${0.8 + enter(localFrame, fps, i * 8, 15) * 0.2})` }}>{st}</div>
            {i < steps.length - 1 ? <span style={{ fontSize: 60, color: accent, opacity: enter(localFrame, fps, i * 8 + 4, 16) }}>→</span> : null}
          </React.Fragment>
        ))}
      </div>
    </Frame>
  );
};

// ── price-tag — offer / price card (with optional strikethrough) ─────────────
export const PriceTag: React.FC<MotionBaseProps & { price?: string; old?: string; label?: string; accent?: string; cover?: boolean }> = ({
  localFrame,
  price = "0 ₽",
  old,
  label = "",
  accent = "#34D399",
  cover = false,
}) => {
  const { fps } = useVideoConfig();
  const s = enter(localFrame, fps, 0, 14);
  return (
    <Frame center={cover}>
      <div style={{ ...glass, padding: "34px 52px", textAlign: "center", transform: `translateY(${(1 - s) * 40}px) scale(${0.9 + s * 0.1})`, opacity: s }}>
        {label ? <div style={{ fontSize: 38, fontWeight: 800, color: BRAND.textDim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>{label}</div> : null}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 20 }}>
          {old ? <span style={{ fontSize: 64, fontWeight: 800, color: BRAND.textDim, textDecoration: "line-through" }}>{old}</span> : null}
          <span style={{ fontSize: 150, fontWeight: 900, color: accent, textShadow: `0 0 40px ${accent}66` }}>{price}</span>
        </div>
      </div>
    </Frame>
  );
};

// ── spec-card — persistent top card (overlay-reels style, docs/style-overlay-reels.md)
// A dark rounded card pinned to the top over the speaker: tag chip + title +
// icon, and a list that ACCUMULATES items line-by-line synced to speech.
// Item types: bullet (icon + text), toggle (iOS switch, turns on), check
// (highlighted accent row). Used as a Shorts916 insert with layout "full" so the
// speaker stays fully visible below.
const Toggle: React.FC<{ accent: string; on: boolean }> = ({ accent, on }) => (
  <div style={{ width: 78, height: 44, borderRadius: 22, background: on ? accent : "rgba(255,255,255,0.18)", position: "relative", flexShrink: 0, transition: "none", boxShadow: on ? `0 0 16px ${accent}88` : "none" }}>
    <div style={{ position: "absolute", top: 5, left: on ? 39 : 5, width: 34, height: 34, borderRadius: "50%", background: "#fff" }} />
  </div>
);

type SpecItem = { type?: "bullet" | "toggle" | "check"; icon?: string; text: string; at?: number };
export const SpecCard: React.FC<
  MotionBaseProps & { tag?: string; title?: string; icon?: string; accent?: string; items?: SpecItem[] }
> = ({ localFrame, tag = "", title = "", icon, accent = BRAND.accent, items = [] }) => {
  const { fps } = useVideoConfig();
  const card = enter(localFrame, fps, 0, 16);
  return (
    <AbsoluteFill style={{ padding: "150px 40px 0", alignItems: "stretch", justifyContent: "flex-start", fontFamily: displayFontFamily }}>
      <div style={{ background: "#0E0F13", border: `2px solid ${accent}`, borderRadius: 30, boxShadow: `0 0 34px ${accent}55, 0 24px 60px rgba(0,0,0,0.55)`, padding: "24px 28px", transform: `translateY(${(1 - card) * -40}px)`, opacity: card }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 18 }}>
          {tag ? <span style={{ background: accent, color: BRAND.accentInk, fontWeight: 900, fontSize: 32, lineHeight: 1, padding: "8px 18px", borderRadius: 12 }}>{tag}</span> : null}
          {icon ? <IconTile name={icon} accent={accent} s={0.85} /> : null}
          <span style={{ fontSize: 40, fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.01em", lineHeight: 1.05 }}>{title}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {items.map((it, i) => {
            const at = it.at ?? 10 + i * 12;
            const s = enter(localFrame, fps, at, 18);
            if (s < 0.02) return null;
            const isCheck = it.type === "check";
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 16, opacity: s, transform: `translateX(${(1 - s) * 26}px)`, background: isCheck ? accent : "transparent", borderRadius: 14, padding: isCheck ? "12px 16px" : "0 2px" }}>
                {it.icon ? (
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: isCheck ? "rgba(10,12,20,0.15)" : `${accent}22`, display: "flex", alignItems: "center", justifyContent: "center", color: isCheck ? BRAND.accentInk : accent, flexShrink: 0 }}>
                    <Icon name={it.icon} size={26} />
                  </div>
                ) : null}
                <span style={{ flex: 1, fontSize: 38, fontWeight: isCheck ? 900 : 600, color: isCheck ? BRAND.accentInk : "#E8ECF4", textTransform: isCheck ? "uppercase" : "none", lineHeight: 1.1 }}>{it.text}</span>
                {it.type === "toggle" ? <Toggle accent={accent} on={s > 0.55} /> : null}
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── SceneBackground — opaque premium backdrop, continuously alive ────────────
// Orbiting accent glows, a travelling diagonal light sweep, slow-drifting rings
// and a parallax grid — so the frame never reads as static or empty.
export const SceneBackground: React.FC<{ localFrame?: number; accent?: string }> = ({ localFrame = 0, accent = BRAND.accent }) => {
  const f = localFrame;
  const gx = (f * 0.35) % 68;
  const gy = (f * 0.55) % 68;
  const orb1x = 14 + Math.cos(f / 55) * 6;
  const orb1y = 12 + Math.sin(f / 48) * 5;
  const orb2x = 74 + Math.sin(f / 62) * 7;
  const orb2y = 74 + Math.cos(f / 58) * 6;
  const sweep = ((f * 6) % 1600) - 400; // diagonal light bar travelling across
  const ring = { borderRadius: "50%", border: `1px solid ${accent}22`, position: "absolute" as const };
  return (
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(120% 85% at 22% 14%, #142544 0%, #0A0C14 55%)," +
          "radial-gradient(100% 70% at 82% 92%, #10182B 0%, rgba(10,12,20,0) 60%)",
      }}
    >
      {/* parallax grid — slowly scrolls */}
      <AbsoluteFill
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)," +
            "linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)",
          backgroundSize: "68px 68px",
          backgroundPosition: `${gx}px ${gy}px`,
          maskImage: "radial-gradient(85% 70% at 50% 44%, black, transparent)",
          WebkitMaskImage: "radial-gradient(85% 70% at 50% 44%, black, transparent)",
        }}
      />
      {/* drifting concentric rings for depth */}
      <div style={{ ...ring, top: "8%", left: "50%", width: 1200, height: 1200, transform: `translate(-50%,0) rotate(${f * 0.15}deg)` }} />
      <div style={{ ...ring, top: "20%", left: "50%", width: 820, height: 820, transform: `translate(-50%,0) rotate(${-f * 0.22}deg)`, borderStyle: "dashed" }} />
      {/* orbiting accent glows */}
      <div style={{ position: "absolute", top: `${orb1y}%`, left: `${orb1x}%`, width: 620, height: 620, borderRadius: "50%", background: `radial-gradient(circle, ${accent}33, transparent 70%)`, filter: "blur(26px)" }} />
      <div style={{ position: "absolute", top: `${orb2y}%`, left: `${orb2x}%`, width: 520, height: 520, borderRadius: "50%", background: "radial-gradient(circle, #1E3A6640, transparent 70%)", filter: "blur(26px)" }} />
      {/* travelling diagonal light sweep */}
      <div style={{ position: "absolute", top: -200, left: sweep, width: 260, height: 2400, transform: "rotate(18deg)", background: `linear-gradient(90deg, transparent, ${accent}12, transparent)`, filter: "blur(8px)" }} />
    </AbsoluteFill>
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
  "stat-grid": StatGrid,
  "timeline-steps": TimelineSteps,
  "quote-card": QuoteCard,
  "big-statement": BigStatement,
  "lower-third": LowerThird,
  "pill-row": PillRow,
  "metric-callout": MetricCallout,
  "phone-mockup": PhoneMockup,
  "chat-bubbles": ChatBubbles,
  "notification-toast": NotificationToast,
  "rating-stars": RatingStars,
  "countdown": Countdown,
  "gauge": Gauge,
  "arrow-flow": ArrowFlow,
  "price-tag": PriceTag,
  "spec-card": SpecCard,
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
