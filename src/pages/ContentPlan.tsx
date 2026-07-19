import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertCircle, CalendarClock, ClipboardList, Clock, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import {
  ContentPeriodPicker,
  type ContentPeriodPreset,
} from "@/components/content/ContentPeriodPicker";
import { ContentPlanTable } from "@/components/content-plan/ContentPlanTable";
import { STATUS_META, TYPE_META, type PostType } from "@/components/autopost/constants";
import { useContentPlan } from "@/hooks/useContentPlan";
import { useInstagramAccount } from "@/hooks/useInstagramAccount";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import type { ReportPeriodRange } from "@/hooks/useReportData";
import { filterContentPlanByPeriod, type ContentPlanItem } from "@/lib/contentPlan";
import { formatPeriodLabel, fromTodayRange } from "@/lib/metricsPeriod";
import { cn } from "@/lib/utils";
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

function almatyLabel(iso: string) {
  const d = new Date(iso);
  const day = d.toLocaleDateString("ru-RU", {
    timeZone: "Asia/Almaty",
    day: "numeric",
    month: "long",
  });
  const time = d.toLocaleTimeString("ru-RU", {
    timeZone: "Asia/Almaty",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${day} · ${time}`;
}

export default function ContentPlan() {
  const [params, setParams] = useSearchParams();
  const showCalendar = params.get("view") === "calendar" || params.get("tab") === "autopost";
  const { items, loading, error, tableMissing, refetch, update, adoptSynthetic, upcomingQueue } =
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
        description="Ближайшие публикации — из очереди MarkVision. Посты, отложенные только в приложении Instagram, Meta в API не отдаёт."
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
            Очередь MarkVision ниже всё равно видна.
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Ближайшие из очереди MarkVision — всегда сверху */}
      {!showCalendar && (
        <section className="mt-5 rounded-2xl border border-border/60 bg-card/40 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Ближайшие в очереди MarkVision</h2>
              <span className="text-xs tabular-nums text-muted-foreground">
                {upcomingQueue.length}
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1 text-xs"
              onClick={() => setAddDay(todayAlmatyYmd())}
            >
              <Plus className="h-3.5 w-3.5" />
              Запланировать
            </Button>
          </div>

          {upcomingQueue.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              В очереди пусто. Если ставил пост «на завтра» только в приложении Instagram — сюда он не
              попадёт (Meta не отдаёт это расписание). Нажми «Новая публикация», выбери завтрашнюю
              дату и запланируй здесь.
            </p>
          ) : (
            <ul className="space-y-2">
              {upcomingQueue.map((p) => {
                const type = (p.media_type ?? "IMAGE") as PostType;
                const meta = TYPE_META[type] ?? TYPE_META.IMAGE;
                const st = STATUS_META[p.status ?? "queued"] ?? STATUS_META.queued;
                return (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-border/50 bg-background/40 px-3 py-2.5"
                  >
                    <div className="h-12 w-10 shrink-0 overflow-hidden rounded-lg bg-muted">
                      {p.thumbnail_url || p.media_url ? (
                        <img
                          src={p.thumbnail_url || p.media_url || ""}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-medium text-foreground">{meta.label}</span>
                        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", st.cls)}>
                          {st.label}
                        </span>
                        <span className="tabular-nums text-muted-foreground">
                          {p.scheduled_at ? almatyLabel(p.scheduled_at) : "—"}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-sm text-foreground">
                        {(p.caption ?? "").trim().split("\n")[0] || "Без подписи"}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
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
