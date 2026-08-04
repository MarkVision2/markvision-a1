import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle, CheckCircle2, Coins, Info, Loader2, RefreshCw,
  Rocket, Search, Target, Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { CampaignGoalsBreakdown } from "@/components/dashboard/CampaignGoalsBreakdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { META_STRUCTURE_QUERY_KEY } from "@/hooks/useMetaDashboard";
import { useAdCampaignLaunches } from "@/hooks/useAdCampaignLaunches";
import { useMetaCampaigns } from "@/hooks/useMetaStructure";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { formatMetaSyncMessages, syncMetaFull } from "@/lib/metaSync";
import {
  buildCampaignWorkspaceSummary,
  filterCampaignRows,
  launchGoalLabel,
  launchStatusLabel,
  type CampaignStatusFilter,
} from "@/lib/campaignWorkspace";
import type { ReportPeriodRange } from "@/hooks/useReportData";
import { cn } from "@/lib/utils";

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const fmtTenge = (n: number) =>
  `${Math.round(n).toLocaleString("ru-RU").replace(/\s/g, "\u00A0")}\u00A0₸`;

const STATUS_FILTERS: { id: CampaignStatusFilter; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "active", label: "Активные" },
  { id: "paused", label: "На паузе" },
];

export function CampaignsWorkspace({
  range,
  onOpenCreatives,
  onCreateCampaign,
}: {
  range: ReportPeriodRange;
  onOpenCreatives?: (campaignName?: string) => void;
  onCreateCampaign?: () => void;
}) {
  const queryClient = useQueryClient();
  const { activeId: projectId } = useProjectsStore();
  const { rows, loading } = useMetaCampaigns(range);
  const { launches } = useAdCampaignLaunches();
  const [status, setStatus] = useState<CampaignStatusFilter>("all");
  const [query, setQuery] = useState("");
  const [syncing, setSyncing] = useState(false);

  const filtered = useMemo(
    () => filterCampaignRows(rows, { status, query }),
    [rows, status, query],
  );
  const summary = useMemo(() => buildCampaignWorkspaceSummary(filtered), [filtered]);
  const activeLaunches = useMemo(
    () => launches.filter((launch) => {
      const value = (launch.status ?? "").toLowerCase();
      return value === "queued" || value === "running" || value === "processing" || value === "error" || value === "failed";
    }).slice(0, 6),
    [launches],
  );

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { error } = await supabase.functions.invoke("meta-structure-sync", {
        body: { since: ymd(range.from), until: ymd(range.to) },
      });
      if (error) throw new Error(error.message);
      await queryClient.invalidateQueries({ queryKey: [META_STRUCTURE_QUERY_KEY, projectId] });
      toast.success("Синхронизация Meta запущена. Кампании и CRM-метрики обновятся через несколько секунд.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось синхронизировать");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-border/60 bg-card/50 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 max-w-2xl">
            <div className="flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary">
                <Target className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-base font-semibold">Кампании по целям</h2>
                <p className="text-xs text-muted-foreground">
                  Meta-расход и результаты группируются по цели (WhatsApp, сайт, форма). ROMI считается по реальным оплатам из CRM, а не по пикселю.
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 rounded-xl"
              disabled={syncing}
              onClick={() => void handleSync()}
            >
              {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Синхронизировать Meta
            </Button>
            {onCreateCampaign && (
              <Button type="button" size="sm" className="h-9 gap-1.5 rounded-xl" onClick={onCreateCampaign}>
                <Rocket className="h-3.5 w-3.5" />
                Создать кампанию
              </Button>
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            icon={Wallet}
            label="Расход за период"
            value={summary.spend > 0 ? fmtTenge(summary.spend) : "—"}
            hint={`${summary.activeCampaigns} активных из ${summary.totalCampaigns}`}
          />
          <SummaryCard
            icon={Target}
            label="Результаты"
            value={summary.results > 0 ? summary.results.toLocaleString("ru-RU") : "—"}
            hint={`${summary.goalCount} ${summary.goalCount === 1 ? "цель" : "целей"}`}
          />
          <SummaryCard
            icon={Coins}
            label="Выручка CRM"
            value={summary.hasCrm ? fmtTenge(summary.crmRevenue) : "—"}
            hint={summary.hasCrm ? `${summary.crmSales} продаж` : "Нужны оплаты в CRM"}
          />
          <SummaryCard
            icon={summary.hasCrm && summary.crmProfit >= 0 ? CheckCircle2 : AlertCircle}
            label="Прибыль · ROMI CRM"
            value={summary.hasCrm ? fmtTenge(summary.crmProfit) : "—"}
            hint={summary.hasCrm && summary.spend > 0
              ? `ROMI ${Math.round(((summary.crmRevenue - summary.spend) / summary.spend) * 100)}%`
              : "Появится после продаж"}
            tone={summary.hasCrm ? (summary.crmProfit >= 0 ? "success" : "danger") : undefined}
          />
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <p>
            Блок «WhatsApp» считает сообщения, «Лиды с сайта» — заявки через пиксель.
            Если ROMI пустой, расход уже есть, а оплаты по этим креативам в CRM ещё не прошли или креативы не синхронизированы.
            {onOpenCreatives && (
              <>
                {" "}
                <button type="button" className="font-medium text-primary hover:underline" onClick={() => onOpenCreatives()}>
                  Открыть креативы
                </button>
              </>
            )}
          </p>
        </div>
      </section>

      {activeLaunches.length > 0 && (
        <section className="rounded-2xl border border-border/60 bg-card/40 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Rocket className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Запуски из MarkVision</h3>
            <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
              {activeLaunches.length}
            </span>
          </div>
          <ul className="space-y-2">
            {activeLaunches.map((launch) => {
              const status = (launch.status ?? "").toLowerCase();
              const failed = status === "error" || status === "failed";
              const running = status === "queued" || status === "running" || status === "processing";
              return (
                <li
                  key={launch.id}
                  className={cn(
                    "rounded-xl border px-3 py-2.5",
                    failed ? "border-destructive/30 bg-destructive/5" : "border-border/60 bg-background/60",
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">
                        {launchGoalLabel(launch.goal)}
                        {launch.budget ? ` · бюджет ${launch.budget}` : ""}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {launch.text || "Без текста"} · {new Date(launch.createdAt).toLocaleString("ru-RU")}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                        failed && "bg-destructive/10 text-destructive",
                        running && "bg-primary/10 text-primary",
                        !failed && !running && "bg-success/10 text-success",
                      )}
                    >
                      {running && <Loader2 className="h-3 w-3 animate-spin" />}
                      {launchStatusLabel(launch)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card/40 p-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск по названию кампании или цели…"
            className="h-10 rounded-xl border-border/60 bg-background pl-10"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setStatus(item.id)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                status === item.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border/60 text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      {loading ? (
        <div className="flex items-center gap-2 rounded-2xl border border-border/60 bg-card/40 px-4 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Загружаем кампании за выбранный период…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 bg-card/30 p-10 text-center">
          <Target className="mx-auto h-6 w-6 text-muted-foreground" />
          <h3 className="mt-3 text-base font-semibold">
            {rows.length === 0 ? "Кампаний пока нет" : "Ничего не найдено"}
          </h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            {rows.length === 0
              ? "Нажмите «Синхронизировать Meta», чтобы подтянуть кампании из рекламных кабинетов, или создайте новую."
              : "Снимите фильтр или измените поисковый запрос."}
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button type="button" variant="outline" className="gap-1.5" disabled={syncing} onClick={() => void handleSync()}>
              {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Синхронизировать Meta
            </Button>
            {onCreateCampaign && (
              <Button type="button" className="gap-1.5" onClick={onCreateCampaign}>
                <Rocket className="h-4 w-4" /> Создать кампанию
              </Button>
            )}
          </div>
        </div>
      ) : (
        <CampaignGoalsBreakdown rows={filtered} onOpenCreatives={onOpenCreatives} />
      )}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  hint: string;
  tone?: "success" | "danger";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/50 bg-background/50 px-3 py-3",
        tone === "success" && "border-success/30 bg-success/5",
        tone === "danger" && "border-destructive/30 bg-destructive/5",
      )}
    >
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div
        className={cn(
          "mt-1 text-lg font-bold tabular-nums",
          tone === "success" && "text-success",
          tone === "danger" && "text-destructive",
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
    </div>
  );
}
