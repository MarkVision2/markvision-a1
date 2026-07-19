import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertCircle, CalendarClock, ClipboardList, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import {
  ContentPeriodPicker,
  type ContentPeriodPreset,
} from "@/components/content/ContentPeriodPicker";
import { ContentPlanTable } from "@/components/content-plan/ContentPlanTable";
import { useContentPlan } from "@/hooks/useContentPlan";
import { useInstagramAccount } from "@/hooks/useInstagramAccount";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import type { ReportPeriodRange } from "@/hooks/useReportData";
import { filterContentPlanByPeriod, type ContentPlanItem } from "@/lib/contentPlan";
import { formatPeriodLabel, fromTodayRange } from "@/lib/metricsPeriod";
import AutoPost, { AutopostAddDialog } from "@/pages/AutoPost";

const todayAlmatyYmd = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Almaty" });

const PRESET_LABELS: Record<ContentPeriodPreset, string> = {
  from_today: "С сегодня",
  this_month: "Этот месяц",
  last_month: "Прошлый месяц",
  last_year: "За год",
  all_time: "Всё время",
  custom: "Свой период",
};

export default function ContentPlan() {
  const [params, setParams] = useSearchParams();
  const showCalendar = params.get("view") === "calendar" || params.get("tab") === "autopost";
  const { items, loading, error, tableMissing, refetch, update, adoptSynthetic } = useContentPlan();
  const { activeId: projectId } = useProjectsStore();
  const { account } = useInstagramAccount();
  const [addDay, setAddDay] = useState<string | null>(null);
  const [preset, setPreset] = useState<ContentPeriodPreset>("from_today");
  const [range, setRange] = useState<ReportPeriodRange>(() => fromTodayRange());

  const setShowCalendar = (on: boolean) => {
    const p = new URLSearchParams(params);
    p.delete("tab");
    if (on) p.set("view", "calendar");
    else p.delete("view");
    setParams(p, { replace: true });
  };

  const periodItems = useMemo(() => filterContentPlanByPeriod(items, range), [items, range]);
  const periodLabel = useMemo(() => formatPeriodLabel(range), [range]);

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

  return (
    <PageContainer wide>
      <PageHeader
        icon={ClipboardList}
        iconAccent="pink"
        title="Контент-план"
        description="Планируйте публикации здесь (карусель 4:5 с обрезкой). Расписание из Instagram-приложения Meta не отдаёт — только через MarkVision или уже вышедшие посты."
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
              {showCalendar ? "К плану" : "Календарь / очередь"}
            </Button>
            <Button size="sm" className="gap-1" onClick={() => setAddDay(todayAlmatyYmd())}>
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
            Выполните миграцию в Supabase SQL Editor.
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="mt-5">
        <ContentPeriodPicker
          preset={preset}
          range={range}
          showCompare={false}
          onPresetChange={(next, nextRange) => {
            setPreset(next);
            setRange(nextRange);
          }}
        />
      </div>

      {showCalendar ? (
        <div className="mt-6">
          <AutoPost embedded />
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              План · {PRESET_LABELS[preset].toLowerCase()}
              <span className="mx-1 text-border">·</span>
              <span className="tabular-nums">{periodLabel}</span>
              {items.length !== periodItems.length ? (
                <>
                  <span className="mx-1 text-border">·</span>
                  {periodItems.length} из {items.length}
                </>
              ) : null}
            </span>
            <Link to="/marketing/content-center" className="text-primary hover:underline">
              Контент-центр (статистика) →
            </Link>
          </div>
          <ContentPlanTable
            items={periodItems}
            loading={loading}
            showFunnelStats={false}
            onTogglePlatform={onTogglePlatform}
            onAdopt={onAdopt}
          />
        </div>
      )}

      {addDay && (
        <AutopostAddDialog
          day={addDay}
          hourReach={new Map()}
          bestHour={null}
          projectId={projectId}
          hasAccount={!!account}
          onClose={() => setAddDay(null)}
          onDone={() => {
            setAddDay(null);
            void refetch();
          }}
        />
      )}
    </PageContainer>
  );
}
