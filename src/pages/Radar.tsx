/**
 * Радар идей — как «рентген для залетевших рилсов»: посты конкурентов с
 * X-фактором (во сколько раз обошли обычный результат автора) → разбор
 * (хук, структура, почему залетел) → сценарий для нас → тема контент-плана.
 * Данные — хук useRadar (edge-функция `radar`); компоненты — src/components/radar.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Plus, Radar as RadarIcon, RefreshCw } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { AddSourceDialog, type AddSourceInput } from "@/components/radar/AddSourceDialog";
import { AuthorsTab } from "@/components/radar/AuthorsTab";
import { IdeaCard } from "@/components/radar/IdeaCard";
import { PostXraySheet } from "@/components/radar/PostXraySheet";
import { Empty, errMsg, fmtUsd, MetricTile } from "@/components/radar/RadarBits";
import { RadarHero } from "@/components/radar/RadarHero";
import { RunsTab } from "@/components/radar/RunsTab";
import { SourcesTab, sourceTitle } from "@/components/radar/SourcesTab";
import { TrendsTab } from "@/components/radar/TrendsTab";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { useRadar } from "@/hooks/useRadar";
import { IDEA_STATUS_META, type Idea, type IdeaStatus, type RadarPlatform, type RadarPost, type RadarSource } from "@/lib/radarClient";
import { cn } from "@/lib/utils";

const IDEA_FILTERS = ["all", "new", "approved", "used", "rejected"] as const;

export default function Radar() {
  const navigate = useNavigate();
  const { activeId: projectId } = useProjectsStore();
  const r = useRadar();
  const { sources, metrics, ideas, posts, groups, runs, crawler, crawling, loading, error, busy } = r;

  const [addOpen, setAddOpen] = useState(false);
  const [addPreset, setAddPreset] = useState<{ platform: RadarPlatform; handle: string } | null>(null);
  const [ideaFilter, setIdeaFilter] = useState<IdeaStatus | "all">("all");
  const [openPost, setOpenPost] = useState<RadarPost | null>(null);
  const [version, setVersion] = useState(0);

  const ownSourceIds = useMemo(() => new Set(sources.filter((s) => s.kind === "own_account").map((s) => s.id)), [sources]);
  const sourcesById = useMemo(() => new Map(sources.map((s) => [s.id, s] as const)), [sources]);
  const postsById = useMemo(() => new Map(posts.map((p) => [p.id, p] as const)), [posts]);
  const postCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of posts) if (p.source_id) m.set(p.source_id, (m.get(p.source_id) ?? 0) + 1);
    return m;
  }, [posts]);
  const runningSourceIds = useMemo(
    () => new Set(runs.filter((run) => run.status === "running" && run.source_id).map((run) => run.source_id as string)),
    [runs],
  );
  const crawlerMissing = crawler != null && !crawler.direct && !crawler.n8n;
  const aiMissing = crawler != null && !crawler.ai;
  const visibleIdeas = useMemo(
    () => ideas.filter((i) => ideaFilter === "all" || i.status === ideaFilter).sort((a, b) => Number(b.score) - Number(a.score)),
    [ideas, ideaFilter],
  );
  const ideaCounts = useMemo(() => {
    const m: Record<string, number> = { all: ideas.length };
    for (const i of ideas) m[i.status] = (m[i.status] ?? 0) + 1;
    return m;
  }, [ideas]);

  /** Текущая версия поста из ленты (после refetch панель видит свежий статус). */
  const livePost = openPost ? postsById.get(openPost.id) ?? openPost : null;

  const refetch = async () => {
    await r.refetch();
    setVersion((v) => v + 1);
  };

  const addSource = async (input: AddSourceInput) => {
    try {
      const res = await r.upsertSource(input);
      if (res.kicked) toast.success("Источник добавлен, сбор запущен", { description: "Посты появятся через 1–2 минуты, страница обновится сама" });
      else if (res.kick_error) toast.success("Источник добавлен", { description: `Сбор не запущен: ${res.kick_error}` });
      else toast.success("Источник добавлен — сбор пойдёт по расписанию");
      setAddOpen(false);
      setAddPreset(null);
    } catch (e) {
      toast.error(errMsg(e, "Не удалось добавить источник"));
    }
  };

  const analyzeUrl = async (url: string) => {
    try {
      const res = await r.analyzeUrl(url);
      toast.success(res.message || "Разбор запущен");
    } catch (e) {
      toast.error(errMsg(e, "Не удалось разобрать ссылку"));
    }
  };

  const toggleSource = async (s: RadarSource, enabled: boolean) => {
    try {
      await r.upsertSource({
        id: s.id, kind: s.kind, platform: s.platform, handle: s.handle, label: s.label,
        crawl_interval_hours: s.crawl_interval_hours, enabled, crawl_now: false,
      });
    } catch (e) {
      toast.error(errMsg(e, "Не удалось изменить источник"));
    }
  };

  const crawlSource = async (s: RadarSource) => {
    try {
      const res = await r.crawlSource(s.id);
      toast.success(res.kicked ? `Сбор ${sourceTitle(s)} запущен` : "Сборщик недоступен — попробуйте позже", {
        description: res.kicked ? "Посты появятся через 1–2 минуты, страница обновится сама" : undefined,
      });
    } catch (e) {
      toast.error(errMsg(e, "Не удалось запустить сбор"));
    }
  };

  const deleteSource = async (s: RadarSource) => {
    if (!window.confirm(`Удалить источник ${sourceTitle(s)}? Собранные посты останутся.`)) return;
    try {
      await r.deleteSource(s.id);
      toast.success("Источник удалён");
    } catch (e) {
      toast.error(errMsg(e, "Не удалось удалить источник"));
    }
  };

  const analyzePost = async (post: RadarPost) => {
    try {
      const res = await r.analyzePost(post.id);
      setVersion((v) => v + 1);
      toast.success(res.idea_id ? "Разобрано — идея добавлена в банк" : "Разобрано");
    } catch (e) {
      toast.error(errMsg(e, "Разбор не удался"));
    }
  };

  const promoteIdea = async (idea: Pick<Idea, "id" | "title">, groupId: string | null) => {
    try {
      const res = await r.promoteIdea(idea.id, groupId ? { group_id: groupId } : {});
      setVersion((v) => v + 1);
      const to = `/marketing/content-plan/${res.item_id}`;
      toast.success("Тема создана в контент-плане", { description: idea.title, action: { label: "Открыть", onClick: () => navigate(to) } });
    } catch (e) {
      toast.error(errMsg(e, "Не удалось создать тему"));
    }
  };

  const setIdeaStatus = async (idea: Idea, status: Exclude<IdeaStatus, "used">) => {
    try {
      await r.updateIdea(idea.id, { status });
      toast.success(status === "approved" ? "Идея одобрена" : status === "rejected" ? "Идея отклонена" : "Идея возвращена в новые");
    } catch (e) {
      toast.error(errMsg(e, "Не удалось обновить идею"));
    }
  };

  if (!projectId) {
    return (
      <PageContainer>
        <PageHeader icon={RadarIcon} iconAccent="primary" title="Радар идей" />
        <div className="mt-6"><Empty>Выберите проект, чтобы видеть радар.</Empty></div>
      </PageContainer>
    );
  }

  return (
    <PageContainer wide>
      <PageHeader
        icon={RadarIcon}
        iconAccent="primary"
        title="Радар идей"
        description={
          <span className="inline-flex items-center gap-2">
            Залетевшие посты конкурентов → почему сработали → сценарий для вас → тема контент-плана
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="gap-1" onClick={() => void refetch()} disabled={loading}>
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              Обновить
            </Button>
            <Button size="sm" className="gap-1" onClick={() => { setAddPreset(null); setAddOpen(true); }} disabled={busy != null}>
              <Plus className="h-3.5 w-3.5" />
              Добавить источник
            </Button>
          </div>
        }
      />

      {error && <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div>}
      {(crawlerMissing || aiMissing) && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-2 text-sm text-warning" role="status">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="grid gap-0.5">
            {crawlerMissing && <span>Сборщик не настроен: задайте секрет <code className="rounded bg-muted px-1 text-foreground">APIFY_TOKEN</code> в Supabase — без него источники и ссылки не собираются.</span>}
            {aiMissing && <span>AI-разбор не настроен: нужен секрет <code className="rounded bg-muted px-1 text-foreground">OPENAI_API_KEY</code> — посты собираются, но не разбираются.</span>}
          </div>
        </div>
      )}

      <div className="mt-6">
        <RadarHero metrics={metrics} sourcesCount={sources.length} crawling={crawling} busy={busy === "analyze-url"} onAnalyzeUrl={analyzeUrl} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <MetricTile label="Источников" value={metrics?.sources ?? sources.length} />
        <MetricTile label="Постов за 7 дней" value={metrics?.posts_7d ?? 0} />
        <MetricTile label="Залетевших" value={metrics?.posts_viral ?? 0} hint="Постов, обошедших «обычно» автора минимум вдвое" accent={(metrics?.posts_viral ?? 0) > 0} />
        <MetricTile label="Не разобрано" value={metrics?.posts_unanalyzed ?? 0} hint="В очереди на разбор моделью" />
        <MetricTile label="Новых идей" value={metrics?.ideas_new ?? 0} />
        <MetricTile label="Использовано идей" value={metrics?.ideas_used ?? 0} hint="Идей, ставших темами контент-плана" />
        <MetricTile label="Расход за месяц" value={fmtUsd(metrics?.spent_month_usd)} hint="Сборщик (Apify) за текущий месяц" />
      </div>

      <Tabs defaultValue="trends" className="mt-6">
        {/* Пять вкладок со счётчиками не влезают в 390 px одной строкой — переносим. */}
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="trends">Тренды{posts.length ? ` (${posts.length})` : ""}</TabsTrigger>
          <TabsTrigger value="ideas">Идеи{ideas.length ? ` (${ideas.length})` : ""}</TabsTrigger>
          <TabsTrigger value="authors">Авторы</TabsTrigger>
          <TabsTrigger value="sources">Источники{sources.length ? ` (${sources.length})` : ""}</TabsTrigger>
          <TabsTrigger value="runs" className="gap-1.5">
            Сборы{runs.length ? ` (${runs.length})` : ""}
            {crawling && <Loader2 className="h-3 w-3 animate-spin" aria-label="Идёт сбор" />}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="trends" className="mt-4">
          <TrendsTab
            posts={posts}
            ownSourceIds={ownSourceIds}
            busy={busy}
            onOpen={setOpenPost}
            onAnalyze={(p) => void analyzePost(p)}
            onAddSource={() => setAddOpen(true)}
          />
        </TabsContent>

        <TabsContent value="ideas" className="mt-4">
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {IDEA_FILTERS.map((s) => (
              <Button key={s} size="sm" variant={ideaFilter === s ? "default" : "outline"} className="h-8 rounded-full" onClick={() => setIdeaFilter(s)}>
                {s === "all" ? "Все" : IDEA_STATUS_META[s].label}{ideaCounts[s] ? ` ${ideaCounts[s]}` : ""}
              </Button>
            ))}
          </div>
          {visibleIdeas.length === 0 ? (
            <Empty>Идей пока нет — добавьте источники или вставьте ссылку сверху; разбор постов с оценкой ≥ 55 кладёт идеи сюда.</Empty>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {visibleIdeas.map((idea) => (
                <IdeaCard
                  key={idea.id}
                  idea={idea}
                  groups={groups}
                  sourcePost={idea.source_post_ids.map((id) => postsById.get(id)).find(Boolean) ?? null}
                  busy={busy === `promote:${idea.id}` || busy === `idea:${idea.id}`}
                  onPromote={(gid) => promoteIdea(idea, gid)}
                  onStatus={(st) => setIdeaStatus(idea, st)}
                  onOpenPost={setOpenPost}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="authors" className="mt-4">
          <AuthorsTab
            posts={posts}
            sources={sources}
            busy={busy}
            onCrawl={(s) => void crawlSource(s)}
            onAddSource={(platform, handle) => { setAddPreset({ platform, handle }); setAddOpen(true); }}
            onOpenPost={setOpenPost}
          />
        </TabsContent>

        <TabsContent value="sources" className="mt-4">
          <SourcesTab
            sources={sources}
            runningSourceIds={runningSourceIds}
            postCounts={postCounts}
            busy={busy}
            onToggle={(s, v) => void toggleSource(s, v)}
            onCrawl={(s) => void crawlSource(s)}
            onDelete={(s) => void deleteSource(s)}
            onAdd={() => setAddOpen(true)}
          />
        </TabsContent>

        <TabsContent value="runs" className="mt-4">
          <RunsTab runs={runs} sourcesById={sourcesById} />
        </TabsContent>
      </Tabs>

      <AddSourceDialog open={addOpen} onOpenChange={(v) => { setAddOpen(v); if (!v) setAddPreset(null); }} busy={busy === "source"} preset={addPreset} onSubmit={addSource} />
      <PostXraySheet
        post={livePost}
        groups={groups}
        busy={busy}
        version={version}
        onClose={() => setOpenPost(null)}
        onAnalyze={analyzePost}
        onPromote={(ideaId, gid) => promoteIdea({ id: ideaId, title: livePost?.analysis?.idea_title ?? "Идея" }, gid)}
      />
    </PageContainer>
  );
}
