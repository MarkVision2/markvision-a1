import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDownRight, ArrowUpRight, Download, Image as ImageIcon, Layers, Loader2, RefreshCw, Search, Video } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MonthSwitcher, monthRange, monthRangeLabel } from "@/components/ui/month-switcher";
import { useMetaCreatives, type MetaCreativeRow } from "@/hooks/useMetaStructure";
import { useCabinetsStore } from "@/hooks/useCabinetsStore";
import { syncMetaStructure } from "@/lib/metaStructureSync";
import { bestCreativeImage } from "@/lib/metaThumb";
import { cn } from "@/lib/utils";

const fmtNum = (n: number) => Math.round(n).toLocaleString("ru-RU");
const fmtTenge = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;
const pct = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString("ru-RU")}%`;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

type SortKey = "crmRevenue" | "crmRomi" | "crmSales" | "crmLeads" | "spend" | "name";

const SORT_LABELS: Record<SortKey, string> = {
  crmRevenue: "Выручка",
  crmRomi: "ROMI",
  crmSales: "Продажи",
  crmLeads: "Лиды",
  spend: "Расход",
  name: "Имя",
};

const STAGE_COLORS = ["bg-primary", "bg-accent", "bg-warning", "bg-success"] as const;

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  ACTIVE: { label: "Активен", className: "bg-success/15 text-success" },
  PAUSED: { label: "На паузе", className: "bg-warning/15 text-warning" },
  CAMPAIGN_PAUSED: { label: "Кампания на паузе", className: "bg-warning/15 text-warning" },
  ADSET_PAUSED: { label: "Группа на паузе", className: "bg-warning/15 text-warning" },
  DELETED: { label: "Удален", className: "bg-muted/50 text-muted-foreground" },
  ARCHIVED: { label: "В архиве", className: "bg-muted/50 text-muted-foreground" },
};

function creativeStatus(status: string | null) {
  const key = (status ?? "").toUpperCase();
  return STATUS_LABELS[key] ?? {
    label: status ? status.replace(/_/g, " ").toLowerCase() : "Статус не задан",
    className: "bg-muted/50 text-muted-foreground",
  };
}

function prettyCreativeName(row: MetaCreativeRow) {
  const source = row.headline || row.name || "Без названия";
  return source
    .replace(/_/g, " ")
    .replace(/\s+\|\s+/g, " · ")
    .trim();
}

function CreativeThumb({ row }: { row: MetaCreativeRow }) {
  const [failed, setFailed] = useState(false);
  const src = failed
    ? null
    : bestCreativeImage({
      posterUrl: row.posterUrl,
      thumbnailUrl: row.thumbnailUrl,
      imageUrl: row.imageUrl,
      size: 480,
    });
  const Icon = row.creativeType === "video" ? Video : row.creativeType === "carousel" ? Layers : ImageIcon;
  return (
    <div className="relative h-20 w-16 shrink-0 overflow-hidden rounded-xl bg-secondary/40 ring-1 ring-border/50">
      {src ? (
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground/60">
          <Icon className="h-5 w-5" />
          <span className="px-1 text-center text-[9px] leading-tight">нет превью</span>
        </div>
      )}
      <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-md bg-background/85 backdrop-blur">
        <Icon className="h-3 w-3" />
      </span>
    </div>
  );
}

/** Мини-воронка: 4 столбца с относительной высотой и подписью значения. */
function MiniFunnel({ stages }: { stages: { label: string; value: number; display: string }[] }) {
  const max = Math.max(1, ...stages.map((s) => s.value));
  return (
    <div className="flex items-end gap-1.5">
      {stages.map((s, i) => {
        const h = Math.max(8, Math.round((s.value / max) * 40));
        return (
          <div key={s.label} className="flex w-12 flex-col items-center gap-1">
            <div className="text-[10px] font-bold tabular-nums leading-none">{s.display}</div>
            <div className="flex h-10 w-full items-end">
              <div
                className={cn("w-full rounded-sm transition-all", STAGE_COLORS[i] ?? "bg-primary", s.value === 0 && "opacity-30")}
                style={{ height: `${h}px` }}
                title={`${s.label}: ${s.display}`}
              />
            </div>
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{s.label}</div>
          </div>
        );
      })}
    </div>
  );
}

const CreativeFunnel = () => {
  const [monthCursor, setMonthCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const range = useMemo(() => monthRange(monthCursor), [monthCursor]);
  const [sortKey, setSortKey] = useState<SortKey>("crmRevenue");
  const [search, setSearch] = useState("");
  const [onlyWithLeads, setOnlyWithLeads] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const autoSyncKeys = useRef(new Set<string>());

  const { rows, loading, refresh } = useMetaCreatives(range);
  const { cabinets } = useCabinetsStore();
  const metaCabinets = useMemo(
    () => cabinets.filter((cabinet) => (cabinet.provider ?? "meta") === "meta" && cabinet.externalId),
    [cabinets],
  );

  const runSync = async (silent = false) => {
    if (metaCabinets.length === 0) {
      if (!silent) toast.error("Сначала добавьте Meta-кабинет в разделе управления рекламой");
      return;
    }
    setSyncing(true);
    try {
      const results = await Promise.all(
        metaCabinets.map((cabinet) =>
          syncMetaStructure({
            since: ymd(range.from),
            until: ymd(range.to),
            cabinetId: cabinet.id,
          }),
        ),
      );
      const ok = results.flatMap((item) => item.results ?? []).filter((item) => item.ok);
      const campaigns = ok.reduce((sum, item) => sum + (item.campaigns ?? 0), 0);
      const creatives = ok.reduce((sum, item) => sum + (item.creatives ?? 0), 0);
      refresh();
      if (!silent) toast.success(`Креативы обновлены: ${campaigns} кампаний, ${creatives} креативов`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось получить креативы из Meta");
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (loading || syncing || rows.length > 0 || metaCabinets.length === 0) return;
    const key = `${ymd(range.from)}:${ymd(range.to)}:${metaCabinets.map((cabinet) => cabinet.id).join(",")}`;
    if (autoSyncKeys.current.has(key)) return;
    autoSyncKeys.current.add(key);
    void runSync(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, rows.length, metaCabinets, range.from, range.to, syncing]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let r = rows;
    if (onlyWithLeads) r = r.filter((x) => x.crmLeads > 0 || x.leads > 0);
    if (q) r = r.filter((x) => x.name.toLowerCase().includes(q) || x.adId.includes(q));
    const sorted = [...r];
    sorted.sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name);
      return ((b as any)[sortKey] ?? 0) - ((a as any)[sortKey] ?? 0);
    });
    return sorted;
  }, [rows, sortKey, search, onlyWithLeads]);

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, r) => ({
        spend: acc.spend + r.spend,
        crmLeads: acc.crmLeads + r.crmLeads,
        crmQualified: acc.crmQualified + r.crmQualified,
        crmSales: acc.crmSales + r.crmSales,
        crmRevenue: acc.crmRevenue + r.crmRevenue,
      }),
      { spend: 0, crmLeads: 0, crmQualified: 0, crmSales: 0, crmRevenue: 0 },
    );
  }, [filtered]);

  const totalsRomi = totals.spend > 0 ? ((totals.crmRevenue - totals.spend) / totals.spend) * 100 : 0;

  const rangeLabel = useMemo(() => monthRangeLabel(monthCursor), [monthCursor]);

  return (
    <main className="container max-w-7xl py-8 animate-fade-in-up">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Воронка по креативам</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Лид → Квалификация → Продажа → Выручка по каждому креативу за период · {rangeLabel}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MonthSwitcher value={monthCursor} onChange={setMonthCursor} size="lg" />
          <Button
            variant="outline"
            className="h-10 rounded-xl border-border/60 gap-2"
            onClick={() => runSync(false)}
            disabled={loading || syncing || metaCabinets.length === 0}
            title="Получить кампании, креативы и статистику из Meta"
          >
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            <span className="hidden sm:inline">{syncing ? "Синхронизация…" : "Получить данные"}</span>
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10 rounded-xl border-border/60"
            aria-label="Обновить"
            onClick={refresh}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Aggregate KPI strip */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: "Расход", value: fmtTenge(totals.spend) },
          { label: "Лиды CRM", value: fmtNum(totals.crmLeads) },
          { label: "Квалиф.", value: fmtNum(totals.crmQualified) },
          { label: "Продажи", value: fmtNum(totals.crmSales) },
          { label: "Выручка", value: fmtTenge(totals.crmRevenue) },
          {
            label: "ROMI",
            value: `${totalsRomi >= 0 ? "+" : ""}${Math.round(totalsRomi)}%`,
            cls: totalsRomi >= 0 ? "text-success" : "text-destructive",
          },
        ].map((k) => (
          <div key={k.label} className="rounded-2xl border border-border/60 bg-card/60 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k.label}</div>
            <div className={cn("mt-1 text-lg font-bold tabular-nums", k.cls)}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по названию или ad.id"
            className="h-10 rounded-xl border-border/60 pl-9"
          />
        </div>
        <label className="flex items-center gap-2 rounded-xl border border-border/60 bg-card/60 px-3 h-10 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={onlyWithLeads}
            onChange={(e) => setOnlyWithLeads(e.target.checked)}
            className="accent-primary"
          />
          Только с лидами
        </label>
        <div className="flex items-center gap-1 text-xs">
          <span className="text-muted-foreground">Сортировка:</span>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="h-10 rounded-xl border border-border/60 bg-background px-2 text-xs font-medium"
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={k}>{SORT_LABELS[k]}</option>
            ))}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-border/60 bg-card/40 px-4 py-12 text-center text-sm text-muted-foreground">
          {loading
            ? "Загружаем креативы…"
            : metaCabinets.length === 0
              ? "Нет подключенных Meta-кабинетов для синхронизации."
              : onlyWithLeads
                ? "Нет креативов с заявками за выбранный месяц. Отключите фильтр или получите данные из Meta."
                : "Креативы пока не загружены. Нажмите «Получить данные», чтобы синхронизировать Meta."}
          {!loading && !onlyWithLeads && metaCabinets.length > 0 && (
            <div className="mt-3">
              <Button variant="outline" onClick={() => runSync(false)} disabled={syncing} className="gap-2">
                {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Получить данные из Meta
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          {filtered.map((row) => {
            const cr = row.crmLeads > 0 ? (row.crmSales / row.crmLeads) * 100 : 0;
            const romiPositive = row.crmRomi >= 0;
            const RomiIcon = romiPositive ? ArrowUpRight : ArrowDownRight;
            const status = creativeStatus(row.effectiveStatus);
            return (
              <Link
                key={row.id}
                to={`/ads?tab=creatives&ad=${row.adId}`}
                className="group rounded-2xl border border-border/60 bg-card/60 p-3 transition hover:border-primary/40 hover:bg-card/80"
              >
                <div className="flex min-w-0 gap-3">
                  <CreativeThumb row={row} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={cn("rounded-md px-2 py-0.5 text-[10px] font-bold", status.className)}>
                        {status.label}
                      </span>
                      <span className="rounded-md bg-secondary/50 px-2 py-0.5 text-[10px] text-muted-foreground">
                        ID {row.adId}
                      </span>
                    </div>
                    <div className="mt-2 line-clamp-2 text-base font-bold leading-tight group-hover:text-primary" title={row.name}>
                      {prettyCreativeName(row)}
                    </div>
                    {row.primaryText && (
                      <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                        {row.primaryText}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-3 rounded-xl border border-border/40 bg-background/30 p-3">
                  <MiniFunnel
                    stages={[
                      { label: "Заявки", value: row.crmLeads, display: fmtNum(row.crmLeads) },
                      { label: "Диагн.", value: row.crmQualified, display: fmtNum(row.crmQualified) },
                      { label: "Оплаты", value: row.crmSales, display: fmtNum(row.crmSales) },
                      { label: "Выручка", value: row.crmRevenue, display: row.crmRevenue > 0 ? `${Math.round(row.crmRevenue / 1000)}k` : "0" },
                    ]}
                  />
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <div className="rounded-lg bg-secondary/30 px-2 py-2">
                    <div className="text-[10px] text-muted-foreground">Конверсия в оплату</div>
                    <div className="mt-1 font-bold tabular-nums">{cr > 0 ? pct(cr) : "—"}</div>
                  </div>
                  <div className="rounded-lg bg-secondary/30 px-2 py-2">
                    <div className="text-[10px] text-muted-foreground">Средний чек</div>
                    <div className="mt-1 font-bold tabular-nums">{row.crmAvgCheck > 0 ? fmtTenge(row.crmAvgCheck) : "—"}</div>
                  </div>
                  <div className="rounded-lg bg-secondary/30 px-2 py-2">
                    <div className="text-[10px] text-muted-foreground">Расход</div>
                    <div className="mt-1 font-bold tabular-nums">{row.spend > 0 ? fmtTenge(row.spend) : "—"}</div>
                  </div>
                  <div className="rounded-lg bg-secondary/30 px-2 py-2">
                    <div className="text-[10px] text-muted-foreground">Выручка</div>
                    <div className="mt-1 font-bold tabular-nums text-success">{row.crmRevenue > 0 ? fmtTenge(row.crmRevenue) : "—"}</div>
                  </div>
                  <div className="rounded-lg bg-secondary/30 px-2 py-2">
                    <div className="text-[10px] text-muted-foreground">Окупаемость</div>
                    {row.spend > 0 ? (
                      <div className={cn("mt-1 inline-flex items-center gap-1 font-bold tabular-nums", romiPositive ? "text-success" : "text-destructive")}>
                        <RomiIcon className="h-3.5 w-3.5" />
                        {romiPositive ? "+" : ""}{Math.round(row.crmRomi)}%
                      </div>
                    ) : (
                      <div className="mt-1 font-bold">—</div>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-[11px] text-muted-foreground">
        Атрибуция: WhatsApp — через Meta CTWA referral; сайт — через UTM-шаблон с <code className="rounded bg-secondary/60 px-1">utm_content=&#123;&#123;ad.id&#125;&#125;</code>.
        Клик по креативу открывает его карточку в разделе «Управление рекламой».
      </p>
    </main>
  );
};

export default CreativeFunnel;
