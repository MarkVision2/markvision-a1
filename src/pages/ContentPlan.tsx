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
import { ContentPlanKpis } from "@/components/content-plan/ContentPlanKpis";
import { ContentPlanTable } from "@/components/content-plan/ContentPlanTable";
import { useContentPlan } from "@/hooks/useContentPlan";
import { useInstagramAccount } from "@/hooks/useInstagramAccount";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import type { ReportPeriodRange } from "@/hooks/useReportData";
import {
  filterContentPlanByPeriod,
  partitionContentPlan,
  summarizeContentPlan,
  type ContentPlanItem,
} from "@/lib/contentPlan";
import { formatPeriodLabel, monthRange, todayAlmatyYmd } from "@/lib/metricsPeriod";
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
  { id: "this_month", label: "Этот месяц" },
  { id: "last_month", label: "Прошлый месяц" },
  { id: "custom", label: "Выбрать период" },
];

type ListFilter = "all" | "upcoming" | "published";

function SectionHeading({
  title,
  count,
  hint,
}: {
  title: string;
  count: number;
  hint?: string;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
        <span className="ml-2 tabular-nums text-foreground/70">{count}</span>
      </h2>
      {hint ? <span className="text-[11px] text-muted-foreground/80">{hint}</span> : null}
    </div>
  );
}

export default function ContentPlan() {
  const [params, setParams] = useSearchParams();
  const showCalendar = params.get("view") === "calendar" || params.get("tab") === "autopost";
  const { items, loading, error, tableMissing, refetch, adoptSynthetic } =
    useContentPlan();
  const { activeId: projectId } = useProjectsStore();
  const { account, sync } = useInstagramAccount();
  const [addDay, setAddDay] = useState<string | null>(null);
  const [preset, setPreset] = useState<ContentPeriodPreset>("this_month");
  const [range, setRange] = useState<ReportPeriodRange>(() => contentPlanThisMonth());
  const [refreshing, setRefreshing] = useState(false);
  const [listFilter, setListFilter] = useState<ListFilter>("all");

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
  const { upcoming, published } = useMemo(
    () => partitionContentPlan(periodItems),
    [periodItems],
  );

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

  const showUpcoming = listFilter === "all" || listFilter === "upcoming";
  const showPublished = listFilter === "all" || listFilter === "published";

  return (
    <PageContainer wide>
      <PageHeader
        icon={ClipboardList}
        iconAccent="pink"
        title="Контент-план"
        description="Сверху — что ещё выйдет, снизу — что уже опубликовано."
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
        <div className="mt-6 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { id: "all" as const, label: "Все", count: periodItems.length },
                  { id: "upcoming" as const, label: "Запланировано", count: upcoming.length },
                  { id: "published" as const, label: "Опубликовано", count: published.length },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setListFilter(f.id)}
                  className={cn(
                    "rounded-xl border px-3 py-1.5 text-xs font-medium transition",
                    listFilter === f.id
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border/60 bg-card/40 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {f.label}
                  <span className="ml-1.5 tabular-nums opacity-70">{f.count}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="tabular-nums">{periodLabel}</span>
              <Link to="/marketing/content-center" className="text-primary hover:underline">
                Контент-центр →
              </Link>
            </div>
          </div>

          {loading && periodItems.length === 0 ? (
            <ContentPlanTable items={[]} loading onAdopt={onAdopt} />
          ) : periodItems.length === 0 ? (
            <ContentPlanTable items={[]} loading={false} onAdopt={onAdopt} />
          ) : (
            <>
              {showUpcoming && (
                <section>
                  <SectionHeading
                    title="Запланировано"
                    count={upcoming.length}
                    hint="ближайшие слоты сверху"
                  />
                  {upcoming.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
                      Нет запланированных публикаций за период.
                    </div>
                  ) : (
                    <ContentPlanTable
                      items={upcoming}
                      loading={false}
                      onAdopt={onAdopt}
                      showFunnelStats={false}
                    />
                  )}
                </section>
              )}

              {showPublished && (
                <section>
                  <SectionHeading
                    title="Опубликовано"
                    count={published.length}
                    hint="свежие сверху · с метриками"
                  />
                  {published.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
                      Нет вышедших публикаций за период.
                    </div>
                  ) : (
                    <ContentPlanTable
                      items={published}
                      loading={false}
                      onAdopt={onAdopt}
                      showFunnelStats
                    />
                  )}
                </section>
              )}
            </>
          )}
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
