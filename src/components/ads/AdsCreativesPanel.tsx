import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Download, Filter, LayoutGrid, List, Loader2, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { CreativeCard } from "./CreativeCard";
import { CreativeDetailDrawer } from "@/components/creatives/CreativeDetailDrawer";
import {
  classifyGoal,
  useMetaCampaigns,
  useMetaCreatives,
  type MetaCampaignRow,
} from "@/hooks/useMetaStructure";
import { useCabinetsStore } from "@/hooks/useCabinetsStore";
import type { ReportPeriodRange } from "@/hooks/useReportData";
import { PeriodPicker, currentMonthRange } from "@/components/dashboard/PeriodPicker";

type StatusFilter = "active" | "active_or_spent" | "all";
type TypeFilter = "all" | "video" | "image" | "carousel";
type SortKey = "spend" | "ctr" | "cpl" | "leads" | "messages" | "romi" | "crmLeads" | "crmSales" | "crmRevenue" | "crmRomi" | "crmCpl";

const SORT_LABELS: Record<SortKey, string> = {
  crmRomi: "ROMI (CRM)",
  crmRevenue: "Выручка CRM",
  crmSales: "Продажи CRM",
  crmLeads: "Лиды CRM",
  crmCpl: "CPL CRM",
  spend: "Расход",
  romi: "ROMI Meta",
  ctr: "CTR",
  cpl: "CPL Meta",
  leads: "Заявки Meta",
  messages: "Сообщения",
};

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function classifyCampaignWa(camp: MetaCampaignRow | undefined): { isWhatsApp: boolean; goalLabel: string | null } {
  if (!camp) return { isWhatsApp: false, goalLabel: null };
  const goal = classifyGoal(camp.objective, camp.destinationType);
  return { isWhatsApp: goal.key === "whatsapp", goalLabel: goal.label };
}

export function AdsCreativesPanel() {
  const [range, setRange] = useState<ReportPeriodRange>(() => currentMonthRange());
  const [status, setStatus] = useState<StatusFilter>("active_or_spent");
  const [typeF, setTypeF] = useState<TypeFilter>("all");
  const [goalF, setGoalF] = useState<"all" | "whatsapp" | "site">("all");
  const [sort, setSort] = useState<SortKey>("crmRevenue");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [cabinetFilter, setCabinetFilter] = useState<string>("all");
  const [visibleCount, setVisibleCount] = useState(48);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const PAGE_SIZE = 48;
  const [searchParams, setSearchParams] = useSearchParams();
  const focusAdId = searchParams.get("ad");

  const { rows: creatives, loading } = useMetaCreatives(range);
  const { rows: campaigns } = useMetaCampaigns(range);
  const { cabinets } = useCabinetsStore();

  // Deep-link: ?ad=<meta ad_id> opens the matching creative drawer once loaded.
  useEffect(() => {
    if (!focusAdId || creatives.length === 0) return;
    const match = creatives.find((c) => c.adId === focusAdId);
    if (match && openId !== match.id) {
      setOpenId(match.id);
      // Clear the param so re-opening the page doesn't trap user in the drawer.
      setSearchParams((sp) => { sp.delete("ad"); return sp; }, { replace: true });
    }
  }, [focusAdId, creatives, openId, setSearchParams]);

  const campaignById = useMemo(() => {
    const m = new Map<string, MetaCampaignRow>();
    for (const c of campaigns) m.set(c.campaignId, c);
    return m;
  }, [campaigns]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return creatives
      .map((row) => {
        const camp = row.campaignId ? campaignById.get(row.campaignId) : undefined;
        const meta = classifyCampaignWa(camp);
        return { row, campaign: camp, ...meta };
      })
      .filter(({ row, isWhatsApp }) => {
        if (typeF !== "all" && row.creativeType !== typeF) return false;
        const eff = (row.effectiveStatus ?? "").toUpperCase();
        if (status === "active" && eff !== "ACTIVE") return false;
        if (status === "active_or_spent" && eff !== "ACTIVE" && row.spend <= 0) return false;
        if (cabinetFilter !== "all" && row.cabinetId !== cabinetFilter) return false;
        if (goalF === "whatsapp" && !isWhatsApp) return false;
        if (goalF === "site" && isWhatsApp) return false;
        if (q) {
          const hay = `${row.name} ${row.headline ?? ""} ${row.primaryText ?? ""} ${row.adId}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sort === "cpl" || sort === "crmCpl") {
          const av = (a.row[sort] as number) > 0 ? (a.row[sort] as number) : Number.POSITIVE_INFINITY;
          const bv = (b.row[sort] as number) > 0 ? (b.row[sort] as number) : Number.POSITIVE_INFINITY;
          return av - bv;
        }
        return ((b.row[sort] as number) ?? 0) - ((a.row[sort] as number) ?? 0);
      });
  }, [creatives, campaignById, typeF, status, goalF, query, sort, cabinetFilter]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [query, typeF, status, goalF, sort, cabinetFilter, range.from, range.to]);

  const visible = useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount],
  );

  const activeCount = creatives.filter((c) => (c.effectiveStatus ?? "").toUpperCase() === "ACTIVE").length;
  const openCreative = useMemo(
    () => (openId ? filtered.find((f) => f.row.id === openId) ?? null : null),
    [filtered, openId],
  );

  // Close opened card if it's no longer in the filtered list
  useEffect(() => {
    if (openId && !filtered.some((f) => f.row.id === openId)) setOpenId(null);
  }, [filtered, openId]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { error } = await supabase.functions.invoke("meta-structure-sync", {
        body: { since: ymd(range.from), until: ymd(range.to) },
      });
      if (error) throw new Error(error.message);
      toast.success("Синхронизация запущена. Новые данные подтянутся через несколько секунд.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось синхронизировать");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card/50 p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {/* Period */}
          <PeriodPicker range={range} onChange={setRange} />

          {/* Status */}
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className="h-9 rounded-lg border border-border/60 bg-background px-2 text-xs font-medium"
          >
            <option value="active">Только активные</option>
            <option value="active_or_spent">Активные + с расходом</option>
            <option value="all">Все</option>
          </select>

          {/* Type */}
          <select
            value={typeF}
            onChange={(e) => setTypeF(e.target.value as TypeFilter)}
            className="h-9 rounded-lg border border-border/60 bg-background px-2 text-xs font-medium"
          >
            <option value="all">Все типы</option>
            <option value="video">Видео</option>
            <option value="image">Фото</option>
            <option value="carousel">Карусель</option>
          </select>

          {/* Goal */}
          <select
            value={goalF}
            onChange={(e) => setGoalF(e.target.value as typeof goalF)}
            className="h-9 rounded-lg border border-border/60 bg-background px-2 text-xs font-medium"
          >
            <option value="all">Все цели</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="site">Сайт / лиды</option>
          </select>

          {/* Cabinet */}
          {cabinets.length > 1 && (
            <select
              value={cabinetFilter}
              onChange={(e) => setCabinetFilter(e.target.value)}
              className="h-9 max-w-[180px] truncate rounded-lg border border-border/60 bg-background px-2 text-xs font-medium"
            >
              <option value="all">Все кабинеты</option>
              {cabinets.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}

          {/* Sort */}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="h-9 rounded-lg border border-border/60 bg-background px-2 text-xs font-medium"
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={k}>Сортировка: {SORT_LABELS[k]}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1 md:flex-none">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Название / текст / ID"
              className="h-9 w-full rounded-lg border-border/60 bg-background pl-8 text-xs lg:w-56"
            />
          </div>
          <div className="flex rounded-lg border border-border/60 bg-background p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className={cn(
                "grid h-8 w-8 place-items-center rounded-md transition",
                viewMode === "grid" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
              aria-label="Сетка"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={cn(
                "grid h-8 w-8 place-items-center rounded-md transition",
                viewMode === "list" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
              aria-label="Список"
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </div>
          <Button variant="outline" size="sm" className="h-9" onClick={handleSync} disabled={syncing}>
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Обновить из Meta
          </Button>
        </div>
      </div>

      {/* Stats line */}
      <div className="flex flex-wrap items-center gap-3 px-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5" />
          Показано: <span className="font-bold text-foreground">{filtered.length}</span> из {creatives.length}
        </span>
        <span>·</span>
        <span>Активных в кабинете: <span className="font-bold text-success">{activeCount}</span></span>
        {loading && (
          <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> загрузка</span>
        )}
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border/60 bg-card/30 p-12 text-center">
          <Sparkles className="mx-auto h-7 w-7 text-muted-foreground/60" />
          <h3 className="mt-3 text-base font-semibold">Креативов не найдено</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {creatives.length === 0
              ? "Нажмите «Обновить из Meta», чтобы подтянуть объявления из подключённых кабинетов."
              : "Измените фильтры или период."}
          </p>
        </div>
      )}

      {/* Grid */}
      {filtered.length > 0 && viewMode === "grid" && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {visible.map(({ row, isWhatsApp }) => (
            <CreativeCard
              key={row.id}
              row={row}
              isWhatsApp={isWhatsApp}
              active={openId === row.id}
              layout="grid"
              onOpen={() => setOpenId(row.id)}
            />
          ))}
        </div>
      )}

      {filtered.length > 0 && viewMode === "list" && (
        <div className="flex flex-col gap-2">
          {visible.map(({ row, isWhatsApp }) => (
            <CreativeCard
              key={row.id}
              row={row}
              isWhatsApp={isWhatsApp}
              active={openId === row.id}
              layout="list"
              onOpen={() => setOpenId(row.id)}
            />
          ))}
        </div>
      )}

      {filtered.length > visible.length && (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl"
            onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
          >
            Показать ещё ({filtered.length - visible.length})
          </Button>
        </div>
      )}

      {/* Drawer for selected creative */}
      <CreativeDetailDrawer
        row={openCreative?.row ?? null}
        range={range}
        open={!!openId}
        onOpenChange={(v) => { if (!v) setOpenId(null); }}
        campaignName={openCreative?.campaign?.name ?? null}
        isWhatsApp={openCreative?.isWhatsApp ?? false}
      />
    </div>
  );
}
