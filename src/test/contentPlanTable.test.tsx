import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ContentPlanTable } from "@/components/content-plan/ContentPlanTable";
import { emptyFunnel, type ContentPlanItem } from "@/lib/contentPlan";

const item: ContentPlanItem = {
  id: "p1",
  projectId: "proj",
  title: "Тест Reels про маркетинг",
  category: "sales",
  contentType: "REELS",
  status: "published",
  description: "Описание",
  hashtags: null,
  prompts: null,
  commentsNotes: null,
  mediaUrl: null,
  thumbnailUrl: null,
  childUrls: [],
  scheduledAt: null,
  publishedAt: "2026-07-18T12:00:00Z",
  platforms: { instagram: true, facebook: false, threads: false, telegram: false, linkedin: false },
  autopostId: null,
  igMediaId: null,
  codewordId: null,
  codeword: "+",
  utmContent: null,
  adSpend: 0,
  aiAnalysis: null,
  createdAt: "2026-07-18T12:00:00Z",
  updatedAt: "2026-07-18T12:00:00Z",
  funnel: {
    ...emptyFunnel(),
    reach: 1200,
    codewordHits: 7,
    registrations: 3,
    paid: 1,
    revenue: 150000,
  },
};

describe("ContentPlanTable per-publication stats", () => {
  it("shows per-row funnel metrics, not only averages", () => {
    render(
      <MemoryRouter>
        <ContentPlanTable items={[item]} loading={false} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Тест Reels про маркетинг")).toBeInTheDocument();
    expect(screen.getByText("Охват")).toBeInTheDocument();
    expect(screen.getByText("Код-слов")).toBeInTheDocument();
    expect(screen.getByText("Лиды")).toBeInTheDocument();
    expect(screen.getByText("Оплаты")).toBeInTheDocument();
    expect(screen.getByText("Выручка")).toBeInTheDocument();
    expect(screen.getByText("1 200")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
