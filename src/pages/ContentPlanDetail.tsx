import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertCircle, ArrowLeft, Brain, CalendarClock, Clapperboard, Loader2, Save, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ContentPlanFunnelView,
  ContentPlanMetricsGrid,
} from "@/components/content-plan/ContentPlanFunnelView";
import { useContentPlanItem } from "@/hooks/useContentPlan";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import {
  CONTENT_PLAN_STATUS_META,
  CONTENT_PLAN_TYPE_META,
  funnelRoi,
  type ContentPlanStatus,
} from "@/lib/contentPlan";
import { loadMetaAdSpendByIgMedia } from "@/lib/contentPlanAdSpend";
import { fmtKzt } from "@/lib/format";

export default function ContentPlanDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeId: projectId } = useProjectsStore();
  const { item, loading, update, remove, adoptSynthetic } = useContentPlanItem(id);
  const [saving, setSaving] = useState(false);

  const [description, setDescription] = useState<string | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [adSpend, setAdSpend] = useState<string | null>(null);
  const [metaSpend, setMetaSpend] = useState<number | null>(null);
  const [metaSpendLoading, setMetaSpendLoading] = useState(false);

  const draftDescription = description ?? item?.description ?? "";
  const draftAi = aiAnalysis ?? item?.aiAnalysis ?? "";
  const draftSpend = adSpend ?? String(item?.adSpend ?? 0);

  const roi = useMemo(() => (item ? funnelRoi(item.funnel) : null), [item]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!projectId || !item?.igMediaId) {
        setMetaSpend(null);
        return;
      }
      setMetaSpendLoading(true);
      try {
        const map = await loadMetaAdSpendByIgMedia(projectId, [item.igMediaId]);
        if (!cancelled) setMetaSpend(map.get(item.igMediaId) ?? 0);
      } catch {
        if (!cancelled) setMetaSpend(null);
      } finally {
        if (!cancelled) setMetaSpendLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [projectId, item?.igMediaId]);

  if (loading && !item) {
    return (
      <PageContainer>
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Загрузка…
        </div>
      </PageContainer>
    );
  }

  if (!item) {
    return (
      <PageContainer>
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">
          Публикация не найдена.{" "}
          <Link to="/marketing/content-plan" className="underline">
            Вернуться к плану
          </Link>
        </div>
      </PageContainer>
    );
  }

  const saveContent = async () => {
    setSaving(true);
    try {
      let realId = item.id;
      if (item.synthetic) {
        realId = await adoptSynthetic(item);
        toast.success("Публикация добавлена в план");
      }
      // Если расход уже из Meta Ads — не перезаписываем ручное поле в БД.
      const patch: {
        description: string | null;
        aiAnalysis: string | null;
        adSpend?: number;
      } = {
        description: draftDescription || null,
        aiAnalysis: draftAi || null,
      };
      if (!(metaSpend != null && metaSpend > 0)) {
        patch.adSpend = Number(draftSpend) || 0;
      }
      await update(realId, patch);
      toast.success("Сохранено");
      if (realId !== item.id) navigate(`/marketing/content-plan/${realId}`, { replace: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (item.synthetic) {
      navigate("/marketing/content-plan");
      return;
    }
    if (!confirm("Удалить публикацию из контент-плана?")) return;
    try {
      await remove(item.id);
      toast.success("Удалено");
      navigate("/marketing/content-plan");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const typeMeta = CONTENT_PLAN_TYPE_META[item.contentType];
  const statusMeta = CONTENT_PLAN_STATUS_META[item.status];
  const displaySpend =
    metaSpend != null && metaSpend > 0 ? metaSpend : Number(draftSpend) || 0;
  const spendFromMeta = metaSpend != null && metaSpend > 0;

  return (
    <PageContainer wide>
      <div className="mb-4">
        <Button variant="ghost" size="sm" className="gap-1" asChild>
          <Link to="/marketing/content-plan">
            <ArrowLeft className="h-4 w-4" />
            К контент-плану
          </Link>
        </Button>
      </div>

      <PageHeader
        icon={Clapperboard}
        iconAccent="pink"
        title={item.title}
        description={
          <span>
            {typeMeta.emoji} {typeMeta.label} · {statusMeta.label}
            {item.utmContent ? ` · utm_content=${item.utmContent}` : ""}
            {item.codeword ? ` · код «${item.codeword}»` : ""}
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="gap-1" onClick={() => void saveContent()} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Сохранить
            </Button>
            <Button variant="ghost" size="sm" className="gap-1 text-destructive" onClick={() => void onDelete()}>
              <Trash2 className="h-3.5 w-3.5" />
              Удалить
            </Button>
          </div>
        }
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="overflow-hidden rounded-2xl border border-border/60 bg-black/90">
          {item.mediaUrl && /\.(mp4|mov|webm)(\?|$)/i.test(item.mediaUrl) ? (
            <video src={item.mediaUrl} controls className="aspect-[9/16] max-h-[70vh] w-full object-contain" />
          ) : item.thumbnailUrl || item.mediaUrl ? (
            <img
              src={item.thumbnailUrl || item.mediaUrl || ""}
              alt=""
              className="aspect-[9/16] max-h-[70vh] w-full object-contain"
            />
          ) : (
            <div className="grid aspect-[9/16] max-h-[70vh] place-items-center text-muted-foreground">
              Нет медиа
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-border/60 bg-card/50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Сводка</div>
            <ContentPlanMetricsGrid funnel={item.funnel} />
            {displaySpend > 0 && (
              <div className="mt-3 rounded-xl border border-border/60 px-3 py-2 text-sm">
                Реклама {fmtKzt(displaySpend)}
                {spendFromMeta && (
                  <span className="ml-2 text-xs text-muted-foreground">из Meta Ads</span>
                )}
                {roi != null && (
                  <span className="ml-2 font-semibold text-success">ROI {roi}%</span>
                )}
              </div>
            )}
          </div>

          {item.synthetic && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              Синтетическая карточка из Instagram / код-слова. Нажмите «Сохранить», чтобы зафиксировать в плане.
            </div>
          )}
        </div>
      </div>

      <Tabs defaultValue="content" className="mt-8">
        <TabsList className="flex h-auto flex-wrap gap-1">
          <TabsTrigger value="content">Контент</TabsTrigger>
          <TabsTrigger value="autopost">Автопостинг</TabsTrigger>
          <TabsTrigger value="analytics">Аналитика</TabsTrigger>
          <TabsTrigger value="funnel">Воронка</TabsTrigger>
          <TabsTrigger value="ai">AI-анализ</TabsTrigger>
        </TabsList>

        <TabsContent value="content" className="mt-4 space-y-3 rounded-2xl border border-border/60 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Статус</Label>
              <Select
                value={item.status}
                onValueChange={(v) => void update(item.id, { status: v as ContentPlanStatus })}
                disabled={item.synthetic}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(CONTENT_PLAN_STATUS_META) as ContentPlanStatus[]).map((k) => (
                    <SelectItem key={k} value={k}>{CONTENT_PLAN_STATUS_META[k].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Расход на рекламу (₸)</Label>
              {spendFromMeta ? (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
                  <div className="text-base font-bold tabular-nums">{fmtKzt(metaSpend!)}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    Подтянуто из Meta Ads по продвижению этого поста
                    {metaSpendLoading ? "…" : ""}
                  </div>
                </div>
              ) : (
                <>
                  <Input
                    value={draftSpend}
                    onChange={(e) => setAdSpend(e.target.value)}
                    inputMode="decimal"
                    placeholder="0"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {item.igMediaId
                      ? metaSpendLoading
                        ? "Ищем расход в Meta Ads…"
                        : "Расход из Meta не найден (нужен буст этого поста + актуальный Meta-токен / sync). Можно указать вручную."
                      : "Нет ig_media_id — укажите расход вручную или дождитесь публикации."}
                  </p>
                </>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Описание / подпись</Label>
            <Textarea value={draftDescription} onChange={(e) => setDescription(e.target.value)} rows={5} />
          </div>
        </TabsContent>

        <TabsContent value="autopost" className="mt-4 space-y-4 rounded-2xl border border-border/60 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock className="h-4 w-4 text-pink-500" />
            Расписание
          </div>
          <div className="text-sm text-muted-foreground">
            Дата:{" "}
            <span className="font-medium text-foreground">
              {item.scheduledAt
                ? new Date(item.scheduledAt).toLocaleString("ru-RU", { timeZone: "Asia/Almaty" })
                : "не задана"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Публикация в Instagram идёт через очередь MarkVision
            (<code className="font-mono">cf_scheduled_posts</code>).
          </p>
          <Button variant="outline" asChild>
            <Link to="/marketing/content-plan?tab=autopost">Открыть очередь автопостинга</Link>
          </Button>
        </TabsContent>

        <TabsContent value="analytics" className="mt-4 space-y-4 rounded-2xl border border-border/60 p-4">
          <ContentPlanMetricsGrid funnel={item.funnel} />
          <p className="text-xs text-muted-foreground">
            Метрики подтягиваются из Instagram Media Sync и воронки код-слов. Расход на рекламу —
            из Meta Ads по бусту этого поста.
          </p>
        </TabsContent>

        <TabsContent value="funnel" className="mt-4 rounded-2xl border border-border/60 p-4">
          <ContentPlanFunnelView funnel={item.funnel} />
        </TabsContent>

        <TabsContent value="ai" className="mt-4 space-y-3 rounded-2xl border border-border/60 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Brain className="h-4 w-4 text-pink-500" />
            AI-анализ публикации
          </div>
          <Textarea
            value={draftAi}
            onChange={(e) => setAiAnalysis(e.target.value)}
            rows={8}
            placeholder={
              item.funnel.reach > 0 && item.funnel.codewordHits / Math.max(item.funnel.comments, 1) < 0.2
                ? "Черновик: высокий охват при низкой конверсии в код-слово. Имеет смысл усилить CTA в первые 3 секунды и повторить код-слово в кадре."
                : "После публикации здесь появятся выводы AI: тема, удержание, лучшее время, рекомендации."
            }
          />
          <p className="text-xs text-muted-foreground">
            Автогенерация AI-выводов — V2. Сейчас можно сохранить ручные заметки аналитика.
          </p>
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
