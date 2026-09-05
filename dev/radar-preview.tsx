/**
 * Локальное превью компонентов «Радара идей» без авторизации и бэкенда:
 * http://localhost:5173/dev/radar-preview.html (только dev-сервер, в сборку не входит).
 */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import "@/index.css";
import { AuthorsTab } from "@/components/radar/AuthorsTab";
import { IdeaCard } from "@/components/radar/IdeaCard";
import { MetricTile, fmtUsd } from "@/components/radar/RadarBits";
import { RadarHero } from "@/components/radar/RadarHero";
import { TrendsTab } from "@/components/radar/TrendsTab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Idea, RadarPost, RadarSource } from "@/lib/radarClient";

const thumb = (seed: string) => `https://picsum.photos/seed/${seed}/400/500`;
const day = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * day).toISOString();

const mk = (over: Partial<RadarPost>): RadarPost => ({
  id: "p", source_id: "s1", platform: "instagram", external_id: "p", url: "https://instagram.com/p/x", author_handle: "dental.clinic",
  published_at: ago(2), media_type: "video", caption: "Три ошибки при отбеливании зубов дома", thumbnail_url: thumb("a"),
  metrics: { likes: 1200, comments: 45, shares: 30, saves: 80, views: 30000 }, followers: 25000, engagement_rate: 0.054, velocity: 12,
  score: 71, analysis: { hook: "Вы всё ещё отбеливаете зубы дома?", niche: "стоматология", structure: { problem: "домашнее отбеливание портит эмаль", solution: "профессиональная чистка", cta: "запишись на консультацию" }, triggers: ["страх", "любопытство"], why_it_works: "бьёт в страх испортить зубы", score: 78, idea_title: "Три ошибки отбеливания", idea_angle: "для родителей", script_outline: "хук → 3 ошибки → CTA" },
  analysis_status: "done", analyzed_at: ago(1), error: null, baseline_views: 4100, baseline_likes: 300, norm_views: 3700, x_factor: 7.3,
  ...over,
});

const posts: RadarPost[] = [
  mk({ id: "1" }),
  mk({ id: "2", platform: "tiktok", author_handle: "ai_sashka", thumbnail_url: thumb("b"), metrics: { likes: 90000, comments: 1200, shares: 5000, saves: 0, views: 40400560 }, followers: 80156, baseline_views: 5932, x_factor: 6811, score: 88, published_at: ago(5), analysis: { ...mk({}).analysis!, niche: "AI", hook: "Это видео сделала нейросеть за 3 минуты" } }),
  mk({ id: "3", platform: "youtube", author_handle: "clinic.yt", thumbnail_url: thumb("c"), metrics: { likes: 300, comments: 10, shares: 0, saves: 0, views: 9000 }, baseline_views: 8000, x_factor: 1.1, score: 42, analysis: null, analysis_status: "pending", published_at: ago(0.3) }),
  mk({ id: "4", author_handle: "zapoinov", source_id: "s2", thumbnail_url: null, media_type: "image", metrics: { likes: 38, comments: 0, shares: 0, saves: 0, views: 0 }, followers: 1007, baseline_views: null, baseline_likes: 20, norm_views: null, x_factor: 1.9, score: 63, published_at: ago(12), analysis_status: "failed", analysis: null, error: "модель вернула пустой ответ" }),
  mk({ id: "5", author_handle: "dental.clinic", thumbnail_url: thumb("e"), metrics: { likes: 200, comments: 3, shares: 1, saves: 4, views: 3900 }, x_factor: 0.9, score: 35, published_at: ago(20), analysis_status: "analyzing", analysis: null }),
];

const sources: RadarSource[] = [
  { id: "s1", project_id: "p", kind: "competitor_account", platform: "instagram", handle: "dental.clinic", label: "Клиника рядом", enabled: true, crawl_interval_hours: 24, last_crawled_at: ago(0.2), last_error: null, created_at: ago(30) },
  { id: "s2", project_id: "p", kind: "own_account", platform: "instagram", handle: "zapoinov", label: null, enabled: true, crawl_interval_hours: 24, last_crawled_at: ago(0.2), last_error: null, created_at: ago(30) },
];

const idea: Idea = { id: "i1", title: "Три ошибки при отбеливании", hook: "Вы всё ещё отбеливаете зубы дома?", angle: "Показать, что домашнее отбеливание портит эмаль", niche: "стоматология", script_draft: "Хук: вопрос\n1. Полоски\n2. Сода\n3. Уголь\nCTA: консультация", structure: null, source_post_ids: ["1"], score: 82, status: "new", target_group_id: null, content_item_id: null, outcome_score: null, created_at: ago(1) };

function Preview() {
  const [tab, setTab] = useState("trends");
  const noop = async () => {};
  return (
    <div className="mx-auto max-w-7xl p-6">
      <RadarHero metrics={{ sources: 2, posts_total: 60, posts_7d: 12, posts_unanalyzed: 2, posts_viral: 4, ideas_new: 7, ideas_used: 2, spent_month_usd: 1.5, last_run_at: ago(0.1) }} sourcesCount={2} crawling={false} busy={false} onAnalyzeUrl={noop} />
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <MetricTile label="Источников" value={2} /><MetricTile label="Постов за 7 дней" value={12} /><MetricTile label="Залетевших" value={4} accent />
        <MetricTile label="Не разобрано" value={2} /><MetricTile label="Новых идей" value={7} /><MetricTile label="Использовано идей" value={2} /><MetricTile label="Расход за месяц" value={fmtUsd(1.5)} />
      </div>
      <Tabs value={tab} onValueChange={setTab} className="mt-6">
        <TabsList><TabsTrigger value="trends">Тренды (5)</TabsTrigger><TabsTrigger value="ideas">Идеи (1)</TabsTrigger><TabsTrigger value="authors">Авторы</TabsTrigger></TabsList>
        <TabsContent value="trends" className="mt-4"><TrendsTab posts={posts} ownSourceIds={new Set(["s2"])} busy={null} onOpen={() => {}} onAnalyze={() => {}} onAddSource={() => {}} /></TabsContent>
        <TabsContent value="ideas" className="mt-4"><div className="grid gap-3 lg:grid-cols-2"><IdeaCard idea={idea} groups={[{ id: "g", name: "Группа А", persona_id: null, review_mode: null }]} sourcePost={posts[0]} busy={false} onPromote={noop} onStatus={noop} onOpenPost={() => {}} /><IdeaCard idea={{ ...idea, id: "i2", status: "used", content_item_id: "x", hook: null }} groups={[]} sourcePost={null} busy={false} onPromote={noop} onStatus={noop} onOpenPost={() => {}} /></div></TabsContent>
        <TabsContent value="authors" className="mt-4"><AuthorsTab posts={posts} sources={sources} busy={null} onCrawl={() => {}} onAddSource={() => {}} onOpenPost={() => {}} /></TabsContent>
      </Tabs>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><MemoryRouter><Preview /></MemoryRouter></StrictMode>);
