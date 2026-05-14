import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  Film,
  LayoutGrid,
  Megaphone,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  ShoppingCart,
  Target,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import AddCabinetDialog from "@/components/ads/AddCabinetDialog";
import CreateCampaignDialog from "@/components/ads/CreateCampaignDialog";
import CabinetRow from "@/components/ads/CabinetRow";
import { AdsCreativesPanel } from "@/components/ads/AdsCreativesPanel";
import { CampaignGoalsBreakdown } from "@/components/dashboard/CampaignGoalsBreakdown";
import { useMetaCampaigns } from "@/hooks/useMetaStructure";
import { getPresetRange } from "@/hooks/useDashboardData";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCabinetsStore } from "@/hooks/useCabinetsStore";

const MONTHS_RU = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

const SEARCH_THRESHOLD = 3;

const StatChip = ({
  label,
  value,
  accent,
  icon: Icon,
}: {
  label: string;
  value: string;
  accent: string;
  icon: LucideIcon;
}) => (
  <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/60 px-3 py-2">
    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${accent}`}>
      <Icon className="h-4 w-4" />
    </span>
    <div className="min-w-0 flex-1">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="truncate text-lg font-bold tabular-nums leading-tight">{value}</div>
    </div>
  </div>
);

const Ads = () => {
  const { cabinets, addCabinet, updateCabinet, removeCabinet } = useCabinetsStore();
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [monthCursor, setMonthCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const shiftMonth = (delta: number) =>
    setMonthCursor(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1),
    );

  const monthLabel = `${MONTHS_RU[monthCursor.getMonth()]} ${monthCursor.getFullYear()}`;

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const filtered = useMemo(
    () =>
      cabinets.filter((c) =>
        c.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [cabinets, query],
  );

  const active = cabinets.filter((c) => c.online).length;
  const showSearch = cabinets.length > SEARCH_THRESHOLD;
  const showAggregate = cabinets.length > 1;

  const handleRefresh = () => {
    setRefreshKey((k) => k + 1);
    toast.success("Данные обновлены");
  };

  const handleToggleOnline = (id: string) => {
    const c = cabinets.find((x) => x.id === id);
    if (!c) return;
    updateCabinet(id, { online: !c.online });
    toast.success(c.online ? "Кабинет на паузе" : "Кабинет запущен");
  };

  const totalSpend = cabinets.reduce((s, c) => s + (c.spend || 0), 0);
  const totalLeads = cabinets.reduce((s, c) => s + (c.leads || 0), 0);
  const totalSales = cabinets.reduce((s, c) => s + (c.sales || 0), 0);

  return (
    <main className="container max-w-6xl py-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-success/15 text-success ring-1 ring-success/30">
            <Megaphone className="h-5 w-5" />
          </span>
          <div className="leading-tight">
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
              Управление рекламой
            </h1>
            <p className="text-xs text-muted-foreground">
              {cabinets.length === 0
                ? "Нет подключённых кабинетов"
                : (
                  <>
                    {cabinets.length} {cabinets.length === 1 ? "кабинет" : cabinets.length < 5 ? "кабинета" : "кабинетов"}
                    {" · "}
                    <span className="text-success">{active} активных</span>
                  </>
                )}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-9 items-center gap-0.5 rounded-lg border border-border/60 bg-card/60 px-1">
            <button
              onClick={() => shiftMonth(-1)}
              className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label="Предыдущий месяц"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-2 text-xs font-medium capitalize tabular-nums">
              {monthLabel}
            </span>
            <button
              onClick={() => shiftMonth(1)}
              className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label="Следующий месяц"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="h-9"
            aria-label="Обновить"
            onClick={handleRefresh}
            title="Обновить данные"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>

          <Button
            onClick={() => setAddOpen(true)}
            variant="outline"
            size="sm"
            className="h-9"
          >
            <Plus className="h-3.5 w-3.5" />
            Кабинет
          </Button>

          <Button
            onClick={() => setCampaignOpen(true)}
            size="sm"
            className="h-9 bg-success text-white hover:bg-success/90"
          >
            <Rocket className="h-3.5 w-3.5" />
            Создать кампанию
          </Button>
        </div>
      </div>

      {/* Aggregate KPIs — only when multiple cabinets (otherwise the row itself shows the same numbers) */}
      {showAggregate && (
        <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <StatChip
            label="Расход за месяц"
            value={`${Math.round(totalSpend).toLocaleString("ru-RU").replace(/\s/g, " ")} ₸`}
            accent="bg-warning/15 text-warning"
            icon={Wallet}
          />
          <StatChip
            label="Лиды"
            value={totalLeads.toLocaleString("ru-RU")}
            accent="bg-success/15 text-success"
            icon={Target}
          />
          <StatChip
            label="Продажи"
            value={totalSales.toLocaleString("ru-RU")}
            accent="bg-success/15 text-success"
            icon={ShoppingCart}
          />
        </div>
      )}

      {/* Search — only when there's a real list */}
      {showSearch && (
        <div className="relative mt-5">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по кабинетам…"
            className="h-10 rounded-xl border-border/60 bg-card/60 pl-10"
          />
        </div>
      )}

      {/* List */}
      <div className="mt-5 space-y-3">
        {filtered.map((c) => (
          <CabinetRow
            key={`${c.id}-${refreshKey}`}
            cabinet={c}
            expanded={!!expanded[c.id]}
            onToggle={() => toggleExpanded(c.id)}
            monthCursor={monthCursor}
            onToggleOnline={handleToggleOnline}
            onRemove={removeCabinet}
          />
        ))}

        {filtered.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border/60 bg-card/30 p-12 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-success/10 text-success">
              <Megaphone className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-base font-semibold">
              {cabinets.length === 0 ? "Пока нет кабинетов" : "Кабинеты не найдены"}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {cabinets.length === 0
                ? "Подключите рекламный кабинет, чтобы видеть метрики и запускать кампании"
                : "Попробуйте изменить поисковый запрос"}
            </p>
            {cabinets.length === 0 && (
              <Button
                onClick={() => setAddOpen(true)}
                className="mt-5 h-11 rounded-xl bg-success text-white hover:bg-success/90"
              >
                <Plus className="h-4 w-4" />
                Добавить первый кабинет
              </Button>
            )}
          </div>
        )}
      </div>

      <AddCabinetDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreate={async (c) => {
          try {
            const newId = await addCabinet(c);
            toast.success("Кабинет добавлен");
            if (newId && (c.adAccountId || c.externalId)) {
              toast.message("Подтягиваем статистику из Meta…");
              const today = new Date();
              const since = new Date(today.getFullYear(), today.getMonth(), 1)
                .toISOString().slice(0, 10);
              const until = today.toISOString().slice(0, 10);
              supabase.functions.invoke("meta-daily-sync", {
                body: { cabinet_id: newId, since, until },
              }).then(({ data, error }) => {
                if (error) {
                  toast.error("Sync ошибка: " + error.message);
                  return;
                }
                const r = (data?.results ?? [])[0];
                if (r?.ok) {
                  toast.success(
                    `Статистика загружена: ${r.days} дн., ${r.leads} лидов, расход ${Math.round(r.spend)}`,
                  );
                  setRefreshKey((k) => k + 1);
                } else if (r) {
                  toast.error("Meta: " + (r.error || "не удалось получить данные"));
                }
              });
            }
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Не удалось добавить кабинет");
          }
        }}
      />
      <CreateCampaignDialog
        open={campaignOpen}
        onOpenChange={setCampaignOpen}
        cabinets={cabinets}
      />
    </main>
  );
};

export default Ads;
