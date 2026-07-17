import React from "react";
import { AbsoluteFill, Series, useCurrentFrame } from "remotion";
import { brandFontFamily } from "./fonts";
import { BRAND } from "./brand";
import {
  SceneBackground,
  NumberCounter,
  VsCompare,
  ChecklistReveal,
  FakeTerminal,
  FakeDashboardBars,
  KineticType,
  AnnotateArrowHighlight,
  LoadingToDone,
  StatGrid,
  TimelineSteps,
  QuoteCard,
  BigStatement,
  LowerThird,
  PillRow,
  MetricCallout,
  PhoneMockup,
  ChatBubbles,
  NotificationToast,
  RatingStars,
  Countdown,
  Gauge,
  ArrowFlow,
  PriceTag,
} from "./motion";

// Studio + still showcase of the whole motion library on the premium backdrop.
const SEG = 60;
const D = SEG;

const items: { name: string; el: (f: number) => React.ReactNode }[] = [
  { name: "kinetic-type", el: (f) => <KineticType localFrame={f} duration={D} words={["ВАЙБ-", "КОДИНГ"]} accentIndex={1} accent="#FF7A18" icon="code" /> },
  { name: "checklist-reveal", el: (f) => <ChecklistReveal localFrame={f} duration={D} items={["Сайты", "Приложения", "Платформы"]} icons={["globe", "apps", "layers"]} accent="#22D3EE" /> },
  { name: "number-counter", el: (f) => <NumberCounter localFrame={f} duration={D} value={5} suffix="млн ₸" label="ЗАРАБОТАЛ" icon="coin" accent="#34D399" /> },
  { name: "stat-grid", el: (f) => <StatGrid localFrame={f} duration={D} items={[{ icon: "clock", value: "10ч", label: "Экономия" }, { icon: "coin", value: "0₽", label: "Дизайнер" }]} accent="#38BDF8" /> },
  { name: "fake-terminal", el: (f) => <FakeTerminal localFrame={f} duration={D} accent="#22D3EE" /> },
  { name: "fake-dashboard-bars", el: (f) => <FakeDashboardBars localFrame={f} duration={D} title="НАБИРАЕТ ХОД" bars={[{ label: "2023", value: 20 }, { label: "2024", value: 55 }, { label: "2025", value: 100 }]} accent="#8B5CF6" /> },
  { name: "timeline-steps", el: (f) => <TimelineSteps localFrame={f} duration={D} steps={["Диктуешь идею", "ИИ пишет код", "Готовый ролик"]} accent="#34D399" /> },
  { name: "quote-card", el: (f) => <QuoteCard localFrame={f} duration={D} text="Монтаж за 0 рублей" accent="#FFC53D" /> },
  { name: "loading-to-done", el: (f) => <LoadingToDone localFrame={f} duration={D} accent="#34D399" /> },
  { name: "vs-compare", el: (f) => <VsCompare localFrame={f} duration={D} accent="#22D3EE" /> },
  { name: "big-statement", el: (f) => <BigStatement localFrame={f} duration={D} lines={["ВРЕМЯ", "АВТОМАТИЗАЦИИ"]} accent="#FF7A18" /> },
  { name: "lower-third", el: (f) => <LowerThird localFrame={f} duration={D} name="ЮРИЙ" role="IT-предприниматель" icon="award" accent="#8B5CF6" /> },
  { name: "pill-row", el: (f) => <PillRow localFrame={f} duration={D} items={["ChatGPT", "Claude", "Midjourney"]} accent="#22D3EE" /> },
  { name: "metric-callout", el: (f) => <MetricCallout localFrame={f} duration={D} value="+300%" label="Выручка" accent="#34D399" /> },
  { name: "phone-mockup", el: (f) => <PhoneMockup localFrame={f} duration={D} title="MY APP" accent="#38BDF8" /> },
  { name: "chat-bubbles", el: (f) => <ChatBubbles localFrame={f} duration={D} accent="#FF7A18" /> },
  { name: "notification-toast", el: (f) => <NotificationToast localFrame={f} duration={D} title="Новая заявка" text="+1 клиент" icon="bolt" accent="#34D399" /> },
  { name: "rating-stars", el: (f) => <RatingStars localFrame={f} duration={D} rating={5} label="5.0 от учеников" accent="#FFC53D" /> },
  { name: "countdown", el: (f) => <Countdown localFrame={f} duration={D} from={3} label="осталось" accent="#FB7185" /> },
  { name: "gauge", el: (f) => <Gauge localFrame={f} duration={D} value={80} label="Готовность" accent="#22D3EE" /> },
  { name: "arrow-flow", el: (f) => <ArrowFlow localFrame={f} duration={D} steps={["Идея", "ИИ", "Результат"]} accent="#8B5CF6" /> },
  { name: "price-tag", el: (f) => <PriceTag localFrame={f} duration={D} price="0 ₽" old="50 000" label="Стоимость" accent="#34D399" /> },
  { name: "annotate-arrow-highlight", el: (f) => <AnnotateArrowHighlight localFrame={f} duration={D} x={0.5} y={0.42} label="СЮДА" accent="#FB7185" /> },
];

const Seg: React.FC<{ render: (f: number) => React.ReactNode; name: string }> = ({ render, name }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: BRAND.bg }}>
      <SceneBackground localFrame={f} />
      {render(f)}
      <div style={{ position: "absolute", bottom: 40, left: 0, right: 0, textAlign: "center", fontFamily: brandFontFamily, fontSize: 30, color: BRAND.textDim, letterSpacing: "0.06em" }}>{name}</div>
    </AbsoluteFill>
  );
};

export const MotionDemo: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: BRAND.bg }}>
    <Series>
      {items.map((t) => (
        <Series.Sequence key={t.name} durationInFrames={SEG}>
          <Seg render={t.el} name={t.name} />
        </Series.Sequence>
      ))}
    </Series>
  </AbsoluteFill>
);

export const MOTION_DEMO_DURATION = SEG * items.length;
export const MOTION_DEMO_SEG = SEG;
export const MOTION_DEMO_NAMES = items.map((t) => t.name);
