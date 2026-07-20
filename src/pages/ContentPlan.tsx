import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertCircle, CalendarClock, ClipboardList, Info, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import {
  ContentPeriodPicker,
  type ContentPeriodPreset,
} from "@/components/content/ContentPeriodPicker";
import { ContentPlanKpis } from "@/components/content-plan/ContentPlanKpis";
import { ContentPlanTable } from "@/components/content-plan/ContentPlanTable";
import { useContentPlan } from "@/hooks/useContentPlan";
import { useInstagramAccount } from "@/hooks/useInstagramAccount";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import type { ReportPeriodRange } from "@/hooks/useReportData";
import {
  filterContentPlanByPeriod,
  summarizeContentPlan,
  type ContentPlanItem,
} from "@/lib/contentPlan";
import { formatPeriodLabel, fromTodayRange, monthRange, todayAlmatyYmd } from "@/lib/metricsPeriod";
import { cn } from "@/lib/utils";
import AutoPost, { AutopostAddDialog } from "@/pages/AutoPost";

const PRESET_LABELS: Record<ContentPeriodPreset, string> = {
  from_tomorrow: "С завтра",
  from_today: "С сегодня",
  this_month: "Этот месяц",
  last_month: "Прошлый месяц",
  last_year: "За год",
  all_time: "Всё время",
  custom: "Свой период",
};

/** Полный календарный месяц — чтобы в плане были и будущие слоты этого месяца. */
const contentPlanThisMonth = () => monthRange(new Date());

const CONTENT_PLAN_PERIOD_PRESETS: { id: ContentPeriodPreset; label: string }[] = [
  { id: "from_today", label: "С сегодня" },
  { id: "this_month", label: "Этот месяц" },
  { id: "last_month", label: "Прошлый месяц" },
  { id: "custom", label: "Выбрать период" },
];

export default function ContentPlan() {
  const [params, setParams] = useSearchParams();
  const showCalendar = params.get("view") === "calendar" || params.get("tab") === "autopost";
  const { items, loading, error, tableMissing, refetch, adoptSynthetic } =
    useContentPlan();
  const { activeId: projectId } = useProjectsStore();
  const { account, sync } = useInstagramAccount();
  const [addDay, setAddDay] = useState<string | null>(null);
  const [preset, setPreset] = useState<ContentPeriodPreset>("from_today");
  const [range, setRange] = useState<ReportPeriodRange>(() => fromTodayRange());
  const [refreshing, setRefreshing] = useState(false);

  const setShowCalendar = (on: boolean) => {
    const p = new URLSearchParams(params);
    p.delete("tab");
    if (on) p.set("view", "calendar");
    else p.delete("view");
    setParams(p, { replace: true });
  };

  const periodItems = useMemo(() => filterContentPlanByPeriod(items, range), [items, range]);
  const summary = useMemo(() => summarizeContentPlan(periodItems), [periodItems]);
  const periodLabel = useMemo(() => formatPeriodLabel(range), [range]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await sync().catch(() => null);
      await refetch();
      toast.success("Обновлено");
    } finally {
      setRefreshing(false);
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
        description="План и метрики после выхода. Очередь MarkVision — в общем списке (без отдельного блока «Ближайшие»)."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              disabled={refreshing}
              onClick={() => void onRefresh()}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
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

      {!showCalendar && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-border/50 bg-card/40 p-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <p>
              Статистика считается с <span className="text-foreground">20 июля 2026</span> (Алматы).
              Более ранние публикации скрыты и в KPI не входят.
            </p>
            <p className="mt-1">
              Посты, запланированные <span className="text-foreground">прямо в приложении Instagram</span>, Meta
              не отдаёт до выхода — в списке их не будет заранее. После выхода нажми «Обновить» —
              пост, охват и воронка подтянутся автоматически.
            </p>
          </div>
        </div>
      )}

      {tableMissing && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-100">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            Таблица <code className="font-mono text-xs">content_plan_items</code> ещё не применена.
            Запланированные посты из очереди всё равно видны в списке ниже.
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
          presets={CONTENT_PLAN_PERIOD_PRESETS}
          onPresetChange={(next, nextRange) => {
            setPreset(next);
            // «Этот месяц» = весь июль (включая будущие слоты), не «по сегодня».
            setRange(next === "this_month" ? contentPlanThisMonth() : nextRange);
          }}
        />
      </div>

      {!showCalendar && (
        <div className="mt-4">
          <ContentPlanKpis
            summary={summary}
            periodLabel={periodLabel}
            presetLabel={PRESET_LABELS[preset]}
          />
        </div>
      )}

      {showCalendar ? (
        <div className="mt-6">
          <AutoPost embedded />
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              Список · {PRESET_LABELS[preset].toLowerCase()}
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
              Контент-центр →
            </Link>
          </div>
          <ContentPlanTable
            items={periodItems}
            loading={loading}
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
