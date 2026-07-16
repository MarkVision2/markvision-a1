import React from "react";
import { AbsoluteFill, Series, useCurrentFrame } from "remotion";
import { brandFontFamily } from "./fonts";
import { BRAND } from "./brand";
import {
  NumberCounter,
  VsCompare,
  ChecklistReveal,
  FakeTerminal,
  FakeDashboardBars,
  KineticType,
  AnnotateArrowHighlight,
  LoadingToDone,
} from "./motion";

// Studio-only showcase of the code-based motion b-roll library (no footage
// needed). Each template plays for ~2.3s so the brand look can be reviewed.
// Registered as composition "MotionDemo" in Root.tsx.

const SEG = 70; // frames per template
const templates = [
  { name: "number-counter", el: (f: number) => <NumberCounter localFrame={f} duration={SEG} value={10} suffix="часов" label="экономит в неделю" /> },
  { name: "vs-compare", el: (f: number) => <VsCompare localFrame={f} duration={SEG} /> },
  { name: "checklist-reveal", el: (f: number) => <ChecklistReveal localFrame={f} duration={SEG} title="ЧТО АВТОМАТИЗИРОВАТЬ" items={["Почту", "Отчёты", "Контент", "Рутину"]} /> },
  { name: "fake-terminal", el: (f: number) => <FakeTerminal localFrame={f} duration={SEG} /> },
  { name: "fake-dashboard-bars", el: (f: number) => <FakeDashboardBars localFrame={f} duration={SEG} /> },
  { name: "kinetic-type", el: (f: number) => <KineticType localFrame={f} duration={SEG} /> },
  { name: "annotate-arrow-highlight", el: (f: number) => (
      <AbsoluteFill>
        <AbsoluteFill style={{ backgroundColor: "#222", alignItems: "center", justifyContent: "center", color: "#555", fontFamily: brandFontFamily, fontSize: 60 }}>
          (спикер тут)
        </AbsoluteFill>
        <AnnotateArrowHighlight localFrame={f} duration={SEG} x={0.5} y={0.42} label="СЮДА" />
      </AbsoluteFill>
    ) },
  { name: "loading-to-done", el: (f: number) => <LoadingToDone localFrame={f} duration={SEG} /> },
];

const Seg: React.FC<{ render: (f: number) => React.ReactNode; name: string }> = ({ render, name }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: BRAND.bg }}>
      {render(f)}
      <div style={{ position: "absolute", bottom: 40, left: 0, right: 0, textAlign: "center", fontFamily: brandFontFamily, fontSize: 34, color: BRAND.textDim, letterSpacing: "0.05em" }}>
        {name}
      </div>
    </AbsoluteFill>
  );
};

export const MotionDemo: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: BRAND.bg }}>
    <Series>
      {templates.map((t) => (
        <Series.Sequence key={t.name} durationInFrames={SEG}>
          <Seg render={t.el} name={t.name} />
        </Series.Sequence>
      ))}
    </Series>
  </AbsoluteFill>
);

export const MOTION_DEMO_DURATION = SEG * templates.length;
