import { useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Megaphone,
  Plus,
  RefreshCw,
  Rocket,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import AddCabinetDialog from "@/components/ads/AddCabinetDialog";
import CreateCampaignDialog from "@/components/ads/CreateCampaignDialog";
import CabinetRow from "@/components/ads/CabinetRow";
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

  return (
    <main className="container max-w-6xl py-8 animate-fade-in-up">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Управление рекламой
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {cabinets.length} кабинетов · {active} активных
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl border border-border/60 bg-card/60 px-2 py-1.5">
            <button
              onClick={() => shiftMonth(-1)}
              className="grid h-8 w-8 place-items-center rounded-lg hover:bg-secondary"
              aria-label="Предыдущий месяц"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-2 text-sm font-medium capitalize">{monthLabel}</span>
            <button
              onClick={() => shiftMonth(1)}
              className="grid h-8 w-8 place-items-center rounded-lg hover:bg-secondary"
              aria-label="Следующий месяц"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11 rounded-xl border-border/60"
            aria-label="Обновить"
            onClick={handleRefresh}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            onClick={() => setAddOpen(true)}
            className="h-11 rounded-xl bg-success text-white hover:bg-success/90"
          >
            <Plus className="h-4 w-4" />
            Добавить кабинет
          </Button>
          <Button
            onClick={() => setCampaignOpen(true)}
            className="h-11 rounded-xl bg-success text-white hover:bg-success/90"
          >
            <Rocket className="h-4 w-4" />
            Создать кампанию
          </Button>
        </div>
      </div>

      <div className="relative mt-6">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по кабинетам…"
          className="h-12 rounded-2xl border-border/60 bg-card/60 pl-11"
        />
      </div>

      <div className="mt-8 flex items-center justify-between text-xs uppercase tracking-wider text-muted-foreground">
        <span>Список рекламных кабинетов</span>
        <span>{cabinets.length} кабинетов</span>
      </div>

      <div className="mt-3 space-y-3">
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
          <div className="rounded-2xl border border-dashed border-border/60 p-12 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-success/10 text-success">
              <Megaphone className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-base font-semibold">
              {cabinets.length === 0 ? "Пока нет кабинетов" : "Кабинеты не найдены"}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {cabinets.length === 0
                ? "Добавьте первый рекламный кабинет, чтобы отслеживать метрики"
                : "Попробуйте изменить поисковый запрос"}
            </p>
            {cabinets.length === 0 && (
              <Button
                onClick={() => setAddOpen(true)}
                className="mt-5 h-10 rounded-xl bg-success text-white hover:bg-success/90"
              >
                <Plus className="h-4 w-4" />
                Добавить кабинет
              </Button>
            )}
          </div>
        )}
      </div>

      <AddCabinetDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreate={addCabinet}
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