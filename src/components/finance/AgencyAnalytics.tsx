import { useMemo, useState } from "react";
import { Plus, Percent, Wallet, PiggyBank, TrendingDown, Trash2, X, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  useAgencyClients,
  SERVICE_CATALOG,
  type AgencyClient,
  type AgencyService,
  type AgencyClientStatus,
} from "@/hooks/useAgencyClients";

const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU");
const fmtT = (n: number) => `${fmt(n)}\u00A0₸`;

const STATUS: Record<AgencyClientStatus, { label: string; color: string }> = {
  waiting:   { label: "Ожидает оплаты", color: "bg-warning/15 text-warning border-warning/30" },
  paid:      { label: "Оплачено",       color: "bg-success/15 text-success border-success/30" },
  overdue:   { label: "Просрочено",     color: "bg-destructive/15 text-destructive border-destructive/30" },
  cancelled: { label: "Отменено",       color: "bg-muted text-muted-foreground border-border" },
};

interface KpiCardProps {
  icon: React.ElementType;
  label: string;
  value: string;
  tone?: "default" | "success" | "warning";
}

const KpiCard = ({ icon: Icon, label, value, tone = "default" }: KpiCardProps) => (
  <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
    <div className="flex items-center gap-2.5">
      <span className={cn(
        "grid h-9 w-9 place-items-center rounded-xl ring-1",
        tone === "warning" ? "bg-warning/10 text-warning ring-warning/30" : "bg-success/10 text-success ring-success/30",
      )}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
    </div>
    <div className={cn(
      "mt-3 text-2xl font-bold tabular-nums",
      tone === "success" && "text-success",
      tone === "warning" && "text-warning",
    )}>
      {value}
    </div>
  </div>
);

const AgencyAnalytics = () => {
  const { clients, addClient, updateClient, removeClient } = useAgencyClients();
  const [dialogOpen, setDialogOpen] = useState(false);

  const totals = useMemo(() => {
    const paidClients = clients.filter((c) => c.status === "paid");
    const mrr = paidClients.reduce(
      (sum, c) => sum + c.services.reduce((s, sv) => s + sv.price, 0),
      0,
    );
    const grossRevenue = clients.reduce(
      (sum, c) => sum + c.services.reduce((s, sv) => s + sv.price, 0),
      0,
    );
    const totalCost = clients.reduce(
      (sum, c) => sum + c.services.reduce((s, sv) => s + sv.cost, 0),
      0,
    );
    const profit = mrr - totalCost;
    const margin = mrr > 0 ? (profit / mrr) * 100 : 0;
    return { mrr, grossRevenue, totalCost, profit, margin };
  }, [clients]);

  return (
    <>
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard icon={Wallet} label="MRR (оплачено)" value={fmtT(totals.mrr)} />
        <KpiCard icon={TrendingDown} label="Расходы" value={fmtT(totals.totalCost)} tone="warning" />
        <KpiCard icon={PiggyBank} label="Прибыль" value={fmtT(totals.profit)} tone="success" />
        <KpiCard icon={Percent} label="Маржинальность" value={`${Math.round(totals.margin)}%`} tone="success" />
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl border border-border/60 bg-card/40">
        <div className="flex items-center justify-between border-b border-border/60 px-6 py-4">
          <span className="text-sm font-semibold">
            Клиенты · {clients.length}
          </span>
          <button
            onClick={() => setDialogOpen(true)}
            className="flex items-center gap-2 text-sm font-semibold text-success hover:text-success/80"
          >
            <Plus className="h-4 w-4" />
            Добавить клиента
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead>
              <tr className="border-b border-border/60 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="px-6 py-3 text-left">Клиент</th>
                <th className="px-4 py-3 text-left">Услуги</th>
                <th className="px-4 py-3 text-right">Оплата</th>
                <th className="px-4 py-3 text-right">Расходы</th>
                <th className="px-4 py-3 text-right">Прибыль</th>
                <th className="px-4 py-3 text-right">Маржа</th>
                <th className="px-4 py-3 text-left">Оплата до</th>
                <th className="px-4 py-3 text-left">Статус</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {clients.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-sm text-muted-foreground">
                    Пока нет клиентов. Нажмите «Добавить клиента» чтобы начать.
                  </td>
                </tr>
              )}
              {clients.map((c) => {
                const pay = c.services.reduce((s, sv) => s + sv.price, 0);
                const cost = c.services.reduce((s, sv) => s + sv.cost, 0);
                const profit = pay - cost;
                const margin = pay > 0 ? (profit / pay) * 100 : 0;

                const updateName = (name: string) => updateClient(c.id, { name });

                const setTotalPay = (next: number) => {
                  if (c.services.length === 0) return;
                  if (pay === 0) {
                    const per = next / c.services.length;
                    updateClient(c.id, {
                      services: c.services.map((s) => ({ ...s, price: per })),
                    });
                  } else {
                    const k = next / pay;
                    updateClient(c.id, {
                      services: c.services.map((s) => ({ ...s, price: Math.round(s.price * k) })),
                    });
                  }
                };

                const setTotalCost = (next: number) => {
                  if (c.services.length === 0) return;
                  if (cost === 0) {
                    const per = next / c.services.length;
                    updateClient(c.id, {
                      services: c.services.map((s) => ({ ...s, cost: per })),
                    });
                  } else {
                    const k = next / cost;
                    updateClient(c.id, {
                      services: c.services.map((s) => ({ ...s, cost: Math.round(s.cost * k) })),
                    });
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
                  <tr key={c.id} className="border-b border-border/30 hover:bg-card/40">
                    <td className="px-6 py-3">
                      <Input
                        value={c.name}
                        onChange={(e) => updateName(e.target.value)}
                        className="h-9 w-44 rounded-lg font-semibold"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Popover>
                        <PopoverTrigger asChild>
                          <button className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/40 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
                            {c.services.length === 0
                              ? "0 услуг"
                              : c.services.map((s) => s.name).join(", ")}
                            <Pencil className="h-3 w-3 opacity-60" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-72 p-3" align="start">
                          <div className="text-xs font-semibold text-muted-foreground mb-2">Услуги</div>
                          <div className="flex flex-wrap gap-2">
                            {SERVICE_CATALOG.map((s) => {
                              const active = c.services.some((x) => x.id === s.id);
                              return (
                                <button
                                  key={s.id}
                                  onClick={() => toggleService(s.id)}
                                  className={cn(
                                    "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
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
                    <td className="px-4 py-3 text-right">
                      <Input
                        type="number"
                        value={pay || ""}
                        onChange={(e) => setTotalPay(Number(e.target.value) || 0)}
                        placeholder="0"
                        disabled={c.services.length === 0}
                        className="h-9 ml-auto w-32 rounded-lg text-right font-semibold tabular-nums"
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Input
                        type="number"
                        value={cost || ""}
                        onChange={(e) => setTotalCost(Number(e.target.value) || 0)}
                        placeholder="0"
                        disabled={c.services.length === 0}
                        className="h-9 ml-auto w-32 rounded-lg text-right font-semibold tabular-nums text-destructive"
                      />
                    </td>
                    <td className="px-4 py-4 text-right font-semibold tabular-nums text-success">{fmtT(profit)}</td>
                    <td className="px-4 py-4 text-right tabular-nums">{Math.round(margin)}%</td>
                    <td className="px-4 py-3">
                      <Input
                        type="date"
                        value={c.payDate ?? ""}
                        onChange={(e) => updateClient(c.id, { payDate: e.target.value || undefined })}
                        className="h-9 w-40 rounded-lg"
                      />
                    </td>
                    <td className="px-4 py-4">
                      <Select
                        value={c.status}
                        onValueChange={(v) => updateClient(c.id, { status: v as AgencyClientStatus })}
                      >
                        <SelectTrigger className={cn(
                          "h-9 w-[160px] rounded-xl border text-xs font-semibold",
                          STATUS[c.status].color,
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
                    <td className="px-4 py-4">
                      <button
                        onClick={() => removeClient(c.id)}
                        className="text-muted-foreground transition-colors hover:text-destructive"
                        aria-label="Удалить"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {clients.length > 0 && (
                <tr className="bg-card/60 font-bold">
                  <td className="px-6 py-4">Итого</td>
                  <td className="px-4 py-4 text-muted-foreground">
                    {clients.reduce((s, c) => s + c.services.length, 0)} услуг
                  </td>
                  <td className="px-4 py-4 text-right tabular-nums">{fmtT(totals.grossRevenue)}</td>
                  <td className="px-4 py-4 text-right tabular-nums text-destructive">{fmtT(totals.totalCost)}</td>
                  <td className="px-4 py-4 text-right tabular-nums text-success">{fmtT(totals.grossRevenue - totals.totalCost)}</td>
                  <td className="px-4 py-4 text-right tabular-nums">
                    {totals.grossRevenue > 0
                      ? `${Math.round(((totals.grossRevenue - totals.totalCost) / totals.grossRevenue) * 100)}%`
                      : "0%"}
                  </td>
                  <td className="px-4 py-4" />
                  <td className="px-4 py-4" />
                  <td className="px-4 py-4" />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <NewClientDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onAdd={(c) => addClient(c)}
      />
    </>
  );
};

interface NewClientDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdd: (c: Omit<AgencyClient, "id" | "createdAt">) => void;
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

  const handleSubmit = () => {
    if (!name.trim() || picked.length === 0) return;
    const services = picked.map((id) => {
      const def = SERVICE_CATALOG.find((s) => s.id === id)!;
      return {
        id,
        name: def.name,
        price: prices[id] ?? def.price,
        cost: costs[id] ?? def.cost,
      };
    });
    onAdd({
      name: name.trim(),
      services,
      payDate: payDate || undefined,
      status: "waiting",
    });
    reset();
    onOpenChange(false);
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

          <Button
            onClick={handleSubmit}
            disabled={!name.trim() || picked.length === 0}
            className="h-12 w-full gap-2 rounded-xl bg-success text-success-foreground hover:bg-success/90"
          >
            <Plus className="h-4 w-4" />
            Добавить клиента
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AgencyAnalytics;
