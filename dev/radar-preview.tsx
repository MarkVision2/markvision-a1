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
import { MetricsRow } from "@/components/radar/MetricsRow";
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

/** Живая ссылка из прода — чтобы проверить плеер и звук по-настоящему. */
const REAL_VIDEO = 'https://instagram.fcpq4-1.fna.fbcdn.net/o1/v/t2/f2/m86/AQOwc9vu70kmHCI-IU9O9k0UYy3MQcUPiikbOHek3z2yV2OXTmil-bRNyG3qCm-yrnWTBwpjtgzEUbtpHSnDoEfOeWNK3fN-JJ3qBVY.mp4?_nc_cat=110&_nc_oc=AdqDPYqkJ1_ALc644BtaRfR5b4nl3gLTfiBLXtJhjWP4IfT18GKju0BXRRQXtwQ5l8Y&_nc_sid=5e9851&_nc_ht=instagram.fcpq4-1.fna.fbcdn.net&_nc_ohc=h1hyGYfntKkQ7kNvwHwcCdr&efg=eyJ2ZW5jb2RlX3RhZyI6Inhwdl9wcm9ncmVzc2l2ZS5JTlNUQUdSQU0uQ0xJUFMuQzMuNzIwLmRhc2hfYmFzZWxpbmVfMV92MSIsInhwdl9hc3NldF9pZCI6MjIzMDU3MDk1NDM5NzQ1NiwiYXNzZXRfYWdlX2RheXMiOjM3LCJ2aV91c2VjYXNlX2lkIjoxMDA5OSwiZHVyYXRpb25fcyI6MjAsInVybGdlbl9zb3VyY2UiOiJ3d3cifQ%3D%3D&ccb=17-1&vs=4a7ff20ccf43519a&_nc_vs=HBksFQIYUmlnX3hwdl9yZWVsc19wZXJtYW5lbnRfc3JfcHJvZC83RDQ2Q0E2NjJGODczNzQwRkFCNzhBMjFGOEY3Mzk5M192aWRlb19kYXNoaW5pdC5tcDQVAALIARIAFQIYUWlnX3hwdl9wbGFjZW1lbnRfcGVybWFuZW50X3YyLzVFNDc5NkNCQUQ4MjI3NUFBRjZBNzE5NDk1NDAxMDlDX2F1ZGlvX2Rhc2hpbml0Lm1wNBUCAsgBEgAoABgAGwKIB3VzZV9vaWwBMRJwcm9ncmVzc2l2ZV9yZWNpcGUBMRUAACag3JDWqKz2BxUCKAJDMywXQDRdsi0OVgQYEmRhc2hfYmFzZWxpbmVfMV92MREAdf4HZeadAQA&_nc_gid=-_8bjZaSYhmDc5IjWfwWQQ&_nc_ss=7a22e&_nc_zt=28&oh=00_AQKGzG6QvtVXyn6RhEVBFJh5cWUDQ6IaXWS1CAG5CL24TA&oe=6A9E29FB';

const posts: RadarPost[] = [
  mk({ id: "1", video_url: REAL_VIDEO }),
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

const METRICS = {
  sources: 3, sources_total: 3, posts_total: 28, posts_7d: 28, posts_unanalyzed: 0, posts_analyzed: 28,
  posts_viral: 6, posts_scored: 28, ideas_total: 19, ideas_new: 19, ideas_approved: 0, ideas_used: 2,
  posts_today: 4, best_x_factor: 526.26, best_x_author: "ai_sashka.ua", top_niche: "AI-маркетинг",
  spent_month_crawl_usd: 0.0212, spent_month_ai_usd: 0.0505, spent_month_usd: 0.0717,
  last_run_at: ago(0.1), runs_active: 0,
};

function Preview() {
  const [tab, setTab] = useState("trends");
  const noop = async () => {};
  return (
    <div className="mx-auto max-w-7xl p-6">
      <RadarHero metrics={METRICS} sourcesCount={2} crawling={false} busy={false} onAnalyzeUrl={noop} />
      <MetricsRow metrics={METRICS} sourcesFallback={3} />
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
