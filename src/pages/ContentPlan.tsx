import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertCircle, CalendarClock, ClipboardList, Lightbulb, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { ContentPlanKpis } from "@/components/content-plan/ContentPlanKpis";
import { ContentPlanTable } from "@/components/content-plan/ContentPlanTable";
import { ContentPlanComposerDialog } from "@/components/content-plan/ContentPlanComposerDialog";
import { useContentPlan } from "@/hooks/useContentPlan";
import { useInstagramAccount } from "@/hooks/useInstagramAccount";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import type { ContentPlanItem } from "@/lib/contentPlan";
import AutoPost, { AutopostAddDialog } from "@/pages/AutoPost";

function todayAlmatyYmd() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Almaty" });
}

export default function ContentPlan() {
  const [params, setParams] = useSearchParams();
  const showCalendar = params.get("view") === "calendar" || params.get("tab") === "autopost";
  const { activeId: projectId } = useProjectsStore();
  const { account } = useInstagramAccount();
  const { items, summary, loading, error, tableMissing, refetch, create, update, adoptSynthetic } =
    useContentPlan();
  const [publishOpen, setPublishOpen] = useState(false);
  const [ideaOpen, setIdeaOpen] = useState(false);

  const setShowCalendar = (on: boolean) => {
    const p = new URLSearchParams(params);
    p.delete("tab");
    if (on) p.set("view", "calendar");
    else p.delete("view");
    setParams(p, { replace: true });
  };

  const sorted = useMemo(() => items, [items]);

  const onTogglePlatform = async (
    id: string,
    key: keyof ContentPlanItem["platforms"],
    value: boolean,
  ) => {
    try {
      await update(id, { platforms: { [key]: value } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
    }
  };

  const onAdopt = async (item: ContentPlanItem) => {
    try {
      const id = await adoptSynthetic(item);
      toast.success("Добавлено в контент-план");
      window.location.assign(`/marketing/content-plan/${id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось добавить");
    }
  };

  const onPublished = () => {
    setPublishOpen(false);
    void refetch();
  };

  return (
    <PageContainer wide>
      <PageHeader
        icon={ClipboardList}
        iconAccent="pink"
        title="Контент-план"
        description="Одна лента: медиа → автопостинг → статистика по каждой публикации. Сверху — итоги по всем постам."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="gap-1" onClick={() => void refetch()}>
              <RefreshCw className="h-3.5 w-3.5" />
              Обновить
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => setShowCalendar(!showCalendar)}
            >
              <CalendarClock className="h-3.5 w-3.5" />
              {showCalendar ? "К плану" : "Календарь"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => setIdeaOpen(true)}
            >
              <Lightbulb className="h-3.5 w-3.5" />
              Идея
            </Button>
            <Button size="sm" className="gap-1" onClick={() => setPublishOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              Новая публикация
            </Button>
          </div>
        }
      />

      {tableMissing && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-100">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            Таблица <code className="font-mono text-xs">content_plan_items</code> ещё не применена.
            Выполните миграцию{" "}
            <code className="font-mono text-xs">20260719150000_content_plan_items.sql</code> в
            Supabase SQL Editor. Пока показываем синтетические строки из Instagram и код-слов.
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="mt-6">
        <ContentPlanKpis summary={summary} />
      </div>

      {showCalendar ? (
        <div className="mt-6">
          <AutoPost embedded />
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              У каждой публикации — своя статистика (охват, код-слова, лиды, оплаты). Сверху — средние и суммы по всем.
            </span>
            <Link to="/marketing/content-center" className="text-primary hover:underline">
              Контент-центр →
            </Link>
          </div>
          <ContentPlanTable
            items={sorted}
            loading={loading}
            onTogglePlatform={onTogglePlatform}
            onAdopt={onAdopt}
          />
        </div>
      )}

      {publishOpen && (
        <AutopostAddDialog
          day={todayAlmatyYmd()}
          hourReach={new Map()}
          bestHour={null}
          projectId={projectId}
          hasAccount={!!account}
          onClose={() => setPublishOpen(false)}
          onDone={onPublished}
        />
      )}

      <ContentPlanComposerDialog
        open={ideaOpen}
        onOpenChange={setIdeaOpen}
        onCreate={create}
      />
    </PageContainer>
  );
}
