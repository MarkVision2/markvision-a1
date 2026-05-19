import { useMemo, useState } from "react";
import {
  Plus, Wallet, PiggyBank, TrendingDown, Trash2, X, Pencil,
  Hourglass, AlertTriangle, CheckCircle2, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import {
  useAgencyClients,
  SERVICE_CATALOG,
  type AgencyClient,
  type AgencyService,
  type AgencyClientStatus,
} from "@/hooks/useAgencyClients";

const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU");
const fmtT = (n: number) => `${fmt(n)} ₸`;

const STATUS: Record<AgencyClientStatus, {
  label: string;
  chip: string;
  pill: string;
  rowAccent: string;
  icon: typeof CheckCircle2;
}> = {
  paid: {
    label: "Оплачено",
    chip: "border-success/30 bg-success/10 text-success",
    pill: "bg-success/15 text-success border-success/30",
    rowAccent: "before:bg-success/60",
    icon: CheckCircle2,
  },
  waiting: {
    label: "Ожидает оплаты",
    chip: "border-warning/30 bg-warning/10 text-warning",
    pill: "bg-warning/15 text-warning border-warning/30",
    rowAccent: "before:bg-warning/60",
    icon: Hourglass,
  },
  overdue: {
    label: "Просрочено",
    chip: "border-destructive/30 bg-destructive/10 text-destructive",
    pill: "bg-destructive/15 text-destructive border-destructive/30",
    rowAccent: "before:bg-destructive/60",
    icon: AlertTriangle,
  },
  cancelled: {
    label: "Отменено",
    chip: "border-border/60 bg-muted/40 text-muted-foreground",
    pill: "bg-muted text-muted-foreground border-border",
    rowAccent: "before:bg-muted-foreground/40",
    icon: X,
  },
};

const STATUS_ORDER: AgencyClientStatus[] = ["paid", "waiting", "overdue", "cancelled"];

interface KpiCardProps {
  icon: React.ElementType;
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "success" | "warning" | "destructive";
}

const KpiCard = ({ icon: Icon, label, value, hint, tone = "default" }: KpiCardProps) => (
  <div className="min-w-0 rounded-2xl border border-border/60 bg-card/60 p-4">
    <div className="flex items-center gap-2.5">
      <span className={cn(
        "grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-1",
        tone === "warning" && "bg-warning/10 text-warning ring-warning/30",
        tone === "destructive" && "bg-destructive/10 text-destructive ring-destructive/30",
        tone === "success" && "bg-success/10 text-success ring-success/30",
        tone === "default" && "bg-primary/10 text-primary ring-primary/30",
      )}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
    </div>
    <div className={cn(
      "mt-2.5 truncate text-2xl font-bold tabular-nums",
      tone === "success" && "text-success",
      tone === "warning" && "text-warning",
      tone === "destructive" && "text-destructive",
    )}>
      {value}
    </div>
    {hint && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</div>}
  </div>
);

const AgencyAnalytics = () => {
  const { clients, addClient, updateClient, removeClient } = useAgencyClients();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<AgencyClientStatus | "all">("all");

  const buckets = useMemo(() => {
    const map: Record<AgencyClientStatus, AgencyClient[]> = {
      paid: [], waiting: [], overdue: [], cancelled: [],
    };
    clients.forEach((c) => map[c.status].push(c));
    return map;
  }, [clients]);

  const totals = useMemo(() => {
    const sumPrice = (arr: AgencyClient[]) =>
      arr.reduce((s, c) => s + c.services.reduce((x, sv) => x + sv.price, 0), 0);
    const sumCost = (arr: AgencyClient[]) =>
      arr.reduce((s, c) => s + c.services.reduce((x, sv) => x + sv.cost, 0), 0);

    const mrr = sumPrice(buckets.paid);
    const cost = sumCost(buckets.paid);
    const pending = sumPrice(buckets.waiting) + sumPrice(buckets.overdue);
    const profit = mrr - cost;
    const margin = mrr > 0 ? (profit / mrr) * 100 : 0;

    return { mrr, cost, pending, profit, margin };
  }, [buckets]);

  const filteredClients = useMemo(() => {
    if (statusFilter === "all") return clients;
    return clients.filter((c) => c.status === statusFilter);
  }, [clients, statusFilter]);

  return (
    <>
      {/* KPI grid */}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          icon={Wallet}
          label="MRR · оплачено"
          value={fmtT(totals.mrr)}
          hint={`${buckets.paid.length} ${pluralClient(buckets.paid.length)}`}
        />
        <KpiCard
          icon={Hourglass}
          label="Ожидается"
          value={fmtT(totals.pending)}
          hint={`${buckets.waiting.length + buckets.overdue.length} ${pluralClient(buckets.waiting.length + buckets.overdue.length)} (вкл. просрочки)`}
          tone="warning"
        />
        <KpiCard
          icon={TrendingDown}
          label="Расходы"
          value={fmtT(totals.cost)}
          hint="По оплаченным клиентам"
          tone="destructive"
        />
        <KpiCard
          icon={PiggyBank}
          label="Прибыль"
          value={fmtT(totals.profit)}
          hint={`Маржа ${Math.round(totals.margin)}%`}
          tone="success"
        />
      </div>

      {/* Status filter strip + add */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <FilterChip
            active={statusFilter === "all"}
            onClick={() => setStatusFilter("all")}
            label="Все"
            count={clients.length}
            icon={Users}
            tone="default"
          />
          {STATUS_ORDER.map((s) => {
            const count = buckets[s].length;
            if (count === 0 && statusFilter !== s) return null;
            return (
              <FilterChip
                key={s}
                active={statusFilter === s}
                onClick={() => setStatusFilter(s)}
                label={STATUS[s].label}
                count={count}
                icon={STATUS[s].icon}
                tone={s}
              />
            );
          })}
        </div>
        <Button
          onClick={() => setDialogOpen(true)}
          className="h-9 gap-1.5 rounded-xl bg-success text-success-foreground hover:bg-success/90"
        >
          <Plus className="h-3.5 w-3.5" />
          Добавить клиента
        </Button>
      </div>

      {/* Clients table */}
      <div className="mt-3 overflow-hidden rounded-2xl border border-border/60 bg-card/40">
        {filteredClients.length === 0 ? (
          <div className="grid place-items-center px-6 py-12 text-center">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-success/10 text-success">
              <Users className="h-5 w-5" />
            </div>
            <div className="mt-3 text-sm font-semibold">
              {clients.length === 0 ? "Пока нет клиентов" : "По фильтру ничего не найдено"}
            </div>
            <p className="mt-1 max-w-md text-xs text-muted-foreground">
              {clients.length === 0
                ? "Добавьте первого клиента — будем считать MRR, расходы, прибыль и маржу автоматически."
                : "Снимите фильтр или добавьте клиента с этим статусом."}
            </p>
            {clients.length === 0 && (
              <Button
                onClick={() => setDialogOpen(true)}
                className="mt-4 h-9 gap-1.5 rounded-xl bg-success text-success-foreground hover:bg-success/90"
              >
                <Plus className="h-3.5 w-3.5" />
                Добавить первого клиента
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] table-fixed text-xs">
              <colgroup>
                <col className="w-[14%]" />
                <col className="w-[16%]" />
                <col className="w-[10%]" />
                <col className="w-[10%]" />
                <col className="w-[10%]" />
                <col className="w-[7%]" />
                <col className="w-[12%]" />
                <col className="w-[16%]" />
                <col className="w-[5%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-border/60 bg-card/50 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2.5 text-left">Клиент</th>
                  <th className="px-2 py-2.5 text-left">Услуги</th>
                  <th className="px-2 py-2.5 text-right">Оплата</th>
                  <th className="px-2 py-2.5 text-right">Расходы</th>
                  <th className="px-2 py-2.5 text-right">Прибыль</th>
                  <th className="px-2 py-2.5 text-right">Маржа</th>
                  <th className="px-2 py-2.5 text-left">Оплата до</th>
                  <th className="px-2 py-2.5 text-left">Статус</th>
                  <th className="px-2 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {filteredClients.map((c) => {
                  const pay = c.services.reduce((s, sv) => s + sv.price, 0);
                  const cost = c.services.reduce((s, sv) => s + sv.cost, 0);
                  const profit = pay - cost;
                  const margin = pay > 0 ? (profit / pay) * 100 : 0;
                  const status = STATUS[c.status];

                  const updateName = (name: string) => updateClient(c.id, { name });

                  const setTotalPay = (next: number) => {
                    if (c.services.length === 0) return;
                    if (pay === 0) {
                      const per = next / c.services.length;
                      updateClient(c.id, { services: c.services.map((s) => ({ ...s, price: per })) });
                    } else {
                      const k = next / pay;
                      updateClient(c.id, { services: c.services.map((s) => ({ ...s, price: Math.round(s.price * k) })) });
                    }
                  };
                  const setTotalCost = (next: number) => {
                    if (c.services.length === 0) return;
                    if (cost === 0) {
                      const per = next / c.services.length;
                      updateClient(c.id, { services: c.services.map((s) => ({ ...s, cost: per })) });
                    } else {
                      const k = next / cost;
                      updateClient(c.id, { services: c.services.map((s) => ({ ...s, cost: Math.round(s.cost * k) })) });
                    }
                  };
                  const toggleService = (id: string) => {
                    const exists = c.services.find((s) => s.id === id);
                    if (exists) {
                      updateClient(c.id, { services: c.services.filter((s) => s.id !== id) });
                    } else {
                      const def = SERVICE_CATALOG.find((s) => s.id === id)!;
                      const next: AgencyService = { id: def.id, name: def.name, price: def.price, cost: def.cost };
                      updateClient(c.id, { services: [...c.services, next] });
                    }
                  };

                  return (
                    <tr
                      key={c.id}
                      className={cn(
                        "relative border-b border-border/30 transition-colors hover:bg-card/60",
                        "before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:rounded-r",
                        status.rowAccent,
                      )}
                    >
                      <td className="px-3 py-2">
                        <Input
                          value={c.name}
                          onChange={(e) => updateName(e.target.value)}
                          className="h-7 w-full border-0 bg-transparent px-0 font-semibold shadow-none hover:bg-secondary/40 focus-visible:bg-background focus-visible:px-2 focus-visible:ring-1"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Popover>
                          <PopoverTrigger asChild>
                            <button className="inline-flex w-full max-w-full items-center justify-between gap-1.5 rounded-md border-0 bg-transparent px-0 text-[11px] text-muted-foreground transition-colors hover:bg-secondary/40 hover:px-2 hover:text-foreground">
                              <span className="truncate">
                                {c.services.length === 0 ? "0 услуг" : c.services.map((s) => s.name).join(", ")}
                              </span>
                              <Pencil className="h-3 w-3 shrink-0 opacity-60" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-72 p-3" align="start">
                            <div className="mb-2 text-xs font-semibold text-muted-foreground">Услуги</div>
                            <div className="flex flex-wrap gap-1.5">
                              {SERVICE_CATALOG.map((s) => {
                                const active = c.services.some((x) => x.id === s.id);
                                return (
                                  <button
                                    key={s.id}
                                    onClick={() => toggleService(s.id)}
                                    className={cn(
                                      "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                                      active
                                        ? "border-success bg-success/15 text-success"
                                        : "border-border/60 text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                                    )}
                                  >
                                    {s.name}
                                  </button>
                                );
                              })}
                            </div>
                          </PopoverContent>
                        </Popover>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <Input
                          type="number"
                          value={pay || ""}
                          onChange={(e) => setTotalPay(Number(e.target.value) || 0)}
                          placeholder="0"
                          disabled={c.services.length === 0}
                          className="h-7 w-full border-0 bg-transparent px-0 text-right font-semibold tabular-nums shadow-none hover:bg-secondary/40 focus-visible:bg-background focus-visible:px-2 focus-visible:ring-1"
                        />
                      </td>
                      <td className="px-2 py-2 text-right">
                        <Input
                          type="number"
                          value={cost || ""}
                          onChange={(e) => setTotalCost(Number(e.target.value) || 0)}
                          placeholder="0"
                          disabled={c.services.length === 0}
                          className="h-7 w-full border-0 bg-transparent px-0 text-right font-semibold tabular-nums text-destructive shadow-none hover:bg-secondary/40 focus-visible:bg-background focus-visible:px-2 focus-visible:ring-1"
                        />
                      </td>
                      <td className={cn(
                        "whitespace-nowrap px-2 py-2 text-right font-semibold tabular-nums",
                        profit >= 0 ? "text-success" : "text-destructive",
                      )}>
                        {fmtT(profit)}
                      </td>
                      <td className={cn(
                        "px-2 py-2 text-right tabular-nums",
                        margin >= 0 ? "text-foreground" : "text-destructive",
                      )}>
                        {Math.round(margin)}%
                      </td>
                      <td className="px-2 py-2">
                        <Input
                          type="date"
                          value={c.payDate ?? ""}
                          onChange={(e) => updateClient(c.id, { payDate: e.target.value || undefined })}
                          className="h-7 w-full border-0 bg-transparent px-0 text-xs shadow-none hover:bg-secondary/40 focus-visible:bg-background focus-visible:px-2 focus-visible:ring-1"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Select
                          value={c.status}
                          onValueChange={(v) => updateClient(c.id, { status: v as AgencyClientStatus })}
                        >
                          <SelectTrigger className={cn(
                            "h-8 w-[130px] rounded-md border text-[11px] font-semibold",
                            status.pill,
                          )}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(STATUS).map(([k, v]) => (
                              <SelectItem key={k} value={k}>{v.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-2">
                        <button
                          onClick={() => removeClient(c.id)}
                          className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                          aria-label="Удалить"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {filteredClients.length > 0 && (() => {
                  const totPay = filteredClients.reduce((s, c) => s + c.services.reduce((x, sv) => x + sv.price, 0), 0);
                  const totCost = filteredClients.reduce((s, c) => s + c.services.reduce((x, sv) => x + sv.cost, 0), 0);
                  const totProfit = totPay - totCost;
                  const totMargin = totPay > 0 ? (totProfit / totPay) * 100 : 0;
                  return (
                    <tr className="border-t-2 border-border/60 bg-card/70 font-bold">
                      <td className="px-3 py-3 text-[10px] uppercase tracking-wider text-muted-foreground">Итого</td>
                      <td className="px-2 py-3 text-[11px] text-muted-foreground">
                        {filteredClients.reduce((s, c) => s + c.services.length, 0)} услуг
                      </td>
                      <td className="whitespace-nowrap px-2 py-3 text-right tabular-nums">{fmtT(totPay)}</td>
                      <td className="whitespace-nowrap px-2 py-3 text-right tabular-nums text-destructive">{fmtT(totCost)}</td>
                      <td className={cn(
                        "whitespace-nowrap px-2 py-3 text-right tabular-nums",
                        totProfit >= 0 ? "text-success" : "text-destructive",
                      )}>{fmtT(totProfit)}</td>
                      <td className={cn(
                        "px-2 py-3 text-right tabular-nums",
                        totMargin >= 0 ? "text-foreground" : "text-destructive",
                      )}>{Math.round(totMargin)}%</td>
                      <td className="px-2 py-3 text-[11px] text-muted-foreground">—</td>
                      <td className="px-2 py-3 text-[11px] text-muted-foreground">
                        {filteredClients.length} {pluralClient(filteredClients.length)}
                      </td>
                      <td className="px-2 py-3" />
                    </tr>
                  );
                })()}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <NewClientDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onAdd={(c) => addClient(c)}
      />
    </>
  );
};

function pluralClient(n: number) {
  const m = n % 10;
  if (n % 100 >= 11 && n % 100 <= 14) return "клиентов";
  if (m === 1) return "клиент";
  if (m >= 2 && m <= 4) return "клиента";
  return "клиентов";
}

interface FilterChipProps {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  icon: typeof Users;
  tone: AgencyClientStatus | "default";
}

const FilterChip = ({ active, onClick, label, count, icon: Icon, tone }: FilterChipProps) => {
  const toneClass = tone === "default"
    ? "border-border/60 bg-card/60 text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
    : STATUS[tone].chip;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs font-semibold transition-all",
        toneClass,
        active && "ring-2 ring-offset-2 ring-offset-background",
        active && tone === "default" && "ring-primary/40",
        active && tone === "paid" && "ring-success/40",
        active && tone === "waiting" && "ring-warning/40",
        active && tone === "overdue" && "ring-destructive/40",
        active && tone === "cancelled" && "ring-border",
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
      <span className="rounded-md bg-background/40 px-1.5 text-[10px] tabular-nums">{count}</span>
    </button>
  );
};

interface NewClientDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdd: (c: Omit<AgencyClient, "id" | "createdAt">) => void | Promise<void>;
}

const NewClientDialog = ({ open, onOpenChange, onAdd }: NewClientDialogProps) => {
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [costs, setCosts] = useState<Record<string, number>>({});
  const [payDate, setPayDate] = useState("");

  const reset = () => {
    setName(""); setPicked([]); setPrices({}); setCosts({}); setPayDate("");
  };

  const togglePick = (id: string) => {
    setPicked((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
    const def = SERVICE_CATALOG.find((s) => s.id === id);
    if (def && prices[id] === undefined) setPrices((x) => ({ ...x, [id]: def.price }));
    if (def && costs[id] === undefined) setCosts((x) => ({ ...x, [id]: def.cost }));
  };

  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast({ title: "Укажите имя клиента", variant: "destructive" });
      return;
    }
    if (picked.length === 0) {
      toast({ title: "Выберите хотя бы одну услугу", variant: "destructive" });
      return;
    }
    const services = picked.map((id) => {
      const def = SERVICE_CATALOG.find((s) => s.id === id)!;
      return {
        id,
        name: def.name,
        price: prices[id] ?? def.price,
        cost: costs[id] ?? def.cost,
      };
    });
    setSubmitting(true);
    try {
      await Promise.resolve(
        onAdd({
          name: name.trim(),
          services,
          payDate: payDate || undefined,
          status: "waiting",
        }),
      );
      toast({ title: "Клиент добавлен" });
      reset();
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Не удалось добавить клиента";
      toast({ title: "Ошибка", description: msg, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">Новый клиент</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label>Имя клиента</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Название компании"
              className="h-12 rounded-xl"
            />
          </div>

          <div className="space-y-2">
            <Label>Услуги</Label>
            <div className="flex flex-wrap gap-2">
              {SERVICE_CATALOG.map((s) => {
                const active = picked.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => togglePick(s.id)}
                    className={cn(
                      "rounded-xl border px-4 py-2 text-sm font-medium transition-colors",
                      active
                        ? "border-success bg-success/15 text-success"
                        : "border-border/60 text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                    )}
                  >
                    {s.name}
                  </button>
                );
              })}
            </div>
          </div>

          {picked.length > 0 && (
            <div className="space-y-2">
              <Label>Стоимость услуг</Label>
              <div className="space-y-2 rounded-xl border border-border/60 bg-card/40 p-3">
                {picked.map((id) => {
                  const def = SERVICE_CATALOG.find((s) => s.id === id)!;
                  return (
                    <div key={id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2">
                      <span className="text-sm font-medium">{def.name}</span>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          value={prices[id] ?? def.price}
                          onChange={(e) =>
                            setPrices((x) => ({ ...x, [id]: Number(e.target.value) || 0 }))
                          }
                          className="h-9 w-28 rounded-lg text-right tabular-nums"
                          placeholder="Оплата"
                        />
                        <span className="text-xs text-muted-foreground">оплата</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          value={costs[id] ?? def.cost}
                          onChange={(e) =>
                            setCosts((x) => ({ ...x, [id]: Number(e.target.value) || 0 }))
                          }
                          className="h-9 w-28 rounded-lg text-right tabular-nums"
                          placeholder="Расход"
                        />
                        <span className="text-xs text-muted-foreground">расход</span>
                      </div>
                      <button
                        onClick={() => togglePick(id)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Дата оплаты</Label>
            <Input
              type="date"
              value={payDate}
              onChange={(e) => setPayDate(e.target.value)}
              className="h-12 rounded-xl"
            />
          </div>

          {(!name.trim() || picked.length === 0) && (
            <p className="text-xs text-muted-foreground">
              {!name.trim() ? "Укажите имя клиента" : "Выберите хотя бы одну услугу из списка выше"}
            </p>
          )}
          <Button
            onClick={handleSubmit}
            disabled={!name.trim() || picked.length === 0 || submitting}
            className="h-12 w-full gap-2 rounded-xl bg-success text-success-foreground hover:bg-success/90"
          >
            <Plus className="h-4 w-4" />
            {submitting ? "Добавляем…" : "Добавить клиента"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AgencyAnalytics;
