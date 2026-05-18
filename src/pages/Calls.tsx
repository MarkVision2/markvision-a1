import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  PhoneCall, PhoneOutgoing, PhoneIncoming, PhoneMissed, ExternalLink, Search,
  CheckCircle2, AlertTriangle, Server, Headphones, Phone as PhoneIcon, Filter,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useCrmStore } from "@/hooks/useCrmStore";
import type { Lead, LeadEvent } from "@/types/crm";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";

type Status = "success" | "error" | "answered" | "missed";
type Provider = "tel" | "sip" | "sipuni" | "manual";

type Row = {
  id: string;
  at: string;
  leadId: string;
  leadName: string;
  leadPhone: string;
  kind: "attempt" | "result";
  provider: Provider;
  status: Status;
  direction?: "outgoing" | "incoming";
  durationSec?: number;
  note?: string;
  detail?: string;
};

const PROVIDER_META: Record<Provider, { label: string; icon: typeof PhoneIcon; tone: string }> = {
  tel: { label: "Системный", icon: PhoneIcon, tone: "bg-secondary text-foreground" },
  sip: { label: "SIP-софтфон", icon: Headphones, tone: "bg-primary/10 text-primary" },
  sipuni: { label: "Sipuni", icon: Server, tone: "bg-primary/10 text-primary" },
  manual: { label: "Без набора", icon: PhoneCall, tone: "bg-muted text-muted-foreground" },
};

function flattenCalls(leads: Lead[]): Row[] {
  const rows: Row[] = [];
  for (const lead of leads) {
    for (const ev of (lead.events ?? []) as LeadEvent[]) {
      if (ev.type === "call_attempt") {
        const ok = ev.payload?.ok === true || ev.payload?.ok === "true";
        rows.push({
          id: ev.id,
          at: ev.at,
          leadId: lead.id,
          leadName: lead.name,
          leadPhone: lead.phone,
          kind: "attempt",
          provider: ((ev.payload?.provider as Provider) ?? "tel"),
          status: ok ? "success" : "error",
          detail: (ev.payload?.error as string) || (ev.payload?.warning as string),
        });
      } else if (ev.type === "call_made") {
        const direction = (ev.payload?.direction as "outgoing" | "incoming") ?? "outgoing";
        const callStatus = (ev.payload?.status as "answered" | "missed") ?? "answered";
        rows.push({
          id: ev.id,
          at: ev.at,
          leadId: lead.id,
          leadName: lead.name,
          leadPhone: lead.phone,
          kind: "result",
          provider: "manual",
          status: callStatus,
          direction,
          durationSec: typeof ev.payload?.durationSec === "number" ? ev.payload.durationSec : undefined,
          note: typeof ev.payload?.note === "string" ? ev.payload.note : undefined,
        });
      }
    }
  }
  rows.sort((a, b) => b.at.localeCompare(a.at));
  return rows;
}

function fmtDuration(sec?: number) {
  if (!sec || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m} мин${s ? ` ${s} с` : ""}` : `${s} с`;
}

function StatusBadge({ status }: { status: Status }) {
  const ok = status === "success" || status === "answered";
  const label =
    status === "success" ? "Успех" :
    status === "error"   ? "Ошибка" :
    status === "answered"? "Отвечен" : "Не дозвонились";
  const Icon =
    status === "success" || status === "answered" ? CheckCircle2 :
    status === "missed" ? PhoneMissed : AlertTriangle;
  return (
    <Badge variant="outline" className={cn(
      "gap-1",
      ok ? "border-success/40 bg-success/10 text-success" : "border-destructive/40 bg-destructive/10 text-destructive",
    )}>
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  );
}

const CallsHistory = () => {
  const { leads } = useCrmStore();
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState<"all" | Provider>("all");
  const [status, setStatus] = useState<"all" | "success" | "error" | "answered" | "missed">("all");
  const [leadFilter, setLeadFilter] = useState<string | "all">("all");

  const allRows = useMemo(() => flattenCalls(leads), [leads]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((r) => {
      if (leadFilter !== "all" && r.leadId !== leadFilter) return false;
      if (provider !== "all" && r.provider !== provider) return false;
      if (status !== "all" && r.status !== status) return false;
      if (q) {
        const hay = `${r.leadName} ${r.leadPhone} ${r.detail ?? ""} ${r.note ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allRows, search, provider, status, leadFilter]);

  const stats = useMemo(() => {
    let ok = 0;
    let err = 0;
    for (const r of filtered) {
      if (r.status === "success" || r.status === "answered") ok++;
      else if (r.status === "error" || r.status === "missed") err++;
    }
    return { total: filtered.length, ok, err };
  }, [filtered]);

  const [visibleCount, setVisibleCount] = useState(200);
  // Reset pagination when filters change
  useMemo(() => { setVisibleCount(200); }, [search, provider, status, leadFilter]);
  const visible = filtered.slice(0, visibleCount);
  const hasMore = filtered.length > visible.length;

  const leadOptions = useMemo(() => {
    const ids = new Set(allRows.map((r) => r.leadId));
    return leads.filter((l) => ids.has(l.id));
  }, [leads, allRows]);

  const openLead = (id: string) => navigate(`/crm?lead=${id}`);

  const resetFilters = () => {
    setSearch(""); setProvider("all"); setStatus("all"); setLeadFilter("all");
  };

  return (
    <PageContainer>
      <PageHeader
        icon={PhoneCall}
        title="История звонков"
        description="Все попытки набора и сохранённые итоги звонков по лидам."
        actions={
          <div className="flex flex-wrap gap-2">
            <KpiPill label="Всего" value={stats.total} tone="text-foreground" />
            <KpiPill label="Успех" value={stats.ok} tone="text-success" />
            <KpiPill label="Ошибки" value={stats.err} tone="text-destructive" />
          </div>
        }
      />

      <Card className="mt-6 space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по имени, телефону, комментарию…"
              className="h-9 pl-8 text-sm"
            />
          </div>

          <select
            value={leadFilter}
            onChange={(e) => setLeadFilter(e.target.value as string)}
            className="h-9 max-w-[260px] rounded-md border border-border/60 bg-background px-2 text-xs"
          >
            <option value="all">Все лиды ({leadOptions.length})</option>
            {leadOptions.map((l) => (
              <option key={l.id} value={l.id}>{l.name} · {l.phone}</option>
            ))}
          </select>

          <Button variant="ghost" size="sm" onClick={resetFilters} className="ml-auto gap-1.5 text-xs">
            <Filter className="h-3.5 w-3.5" /> Сбросить
          </Button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <ChipGroup
            label="Провайдер"
            value={provider}
            onChange={(v) => setProvider(v as any)}
            options={[
              { id: "all", label: "Все" },
              { id: "tel", label: "Системный" },
              { id: "sip", label: "SIP" },
              { id: "sipuni", label: "Sipuni" },
              { id: "manual", label: "Без набора" },
            ]}
          />
          <ChipGroup
            label="Статус"
            value={status}
            onChange={(v) => setStatus(v as any)}
            options={[
              { id: "all", label: "Все" },
              { id: "success", label: "Успех", tone: "success" },
              { id: "error", label: "Ошибка", tone: "destructive" },
              { id: "answered", label: "Отвечен", tone: "success" },
              { id: "missed", label: "Не дозвонились", tone: "destructive" },
            ]}
          />
        </div>
      </Card>

      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <div className="grid place-items-center px-3 py-14 text-center">
            <PhoneCall className="mb-2 h-8 w-8 text-muted-foreground/60" />
            <div className="text-sm font-medium">Звонков не найдено</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Попробуйте изменить фильтры или сбросить их.
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {visible.map((r) => {
              const meta = PROVIDER_META[r.provider];
              const Icon = meta.icon;
              const DirIcon = r.direction === "incoming" ? PhoneIncoming : PhoneOutgoing;
              return (
                <li
                  key={r.id}
                  className="grid cursor-pointer grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-2.5 transition-colors hover:bg-secondary/40"
                  onClick={() => openLead(r.leadId)}
                >
                  <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", meta.tone)}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold">{r.leadName}</span>
                      <span className="truncate text-xs text-muted-foreground">{r.leadPhone}</span>
                      {r.kind === "result" && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-secondary/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          <DirIcon className="h-3 w-3" />
                          {r.direction === "incoming" ? "Входящий" : "Исходящий"}
                          {r.durationSec ? ` · ${fmtDuration(r.durationSec)}` : ""}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <span>{new Date(r.at).toLocaleString("ru-RU")}</span>
                      <span>·</span>
                      <span>{meta.label}</span>
                      {r.detail && <span className="truncate">— {r.detail}</span>}
                      {r.note && <span className="truncate">— «{r.note}»</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge status={r.status} />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1 text-xs"
                      onClick={(e) => { e.stopPropagation(); openLead(r.leadId); }}
                    >
                      <ExternalLink className="h-3 w-3" /> Лид
                    </Button>
                  </div>
                </li>
              );
            })}
            {hasMore && (
              <li className="flex items-center justify-center px-3 py-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setVisibleCount((n) => n + 200)}
                  className="text-xs"
                >
                  Показать ещё ({filtered.length - visible.length})
                </Button>
              </li>
            )}
          </ul>
        )}
      </Card>
    </PageContainer>
  );
};

function KpiPill({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/40 px-3 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("text-base font-bold tabular-nums", tone)}>{value}</div>
    </div>
  );
}

function ChipGroup<T extends string>({
  label, value, onChange, options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string; tone?: "success" | "destructive" }[];
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}:</span>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => {
          const active = o.id === value;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onChange(o.id)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                active
                  ? o.tone === "success"
                    ? "border-success/50 bg-success/15 text-success"
                    : o.tone === "destructive"
                    ? "border-destructive/50 bg-destructive/15 text-destructive"
                    : "border-primary/50 bg-primary/10 text-primary"
                  : "border-border/60 bg-background text-muted-foreground hover:bg-secondary/50",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default CallsHistory;