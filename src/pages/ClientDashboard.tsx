import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, Flame, Snowflake, ThermometerSun } from "lucide-react";
import { cn } from "@/lib/utils";

const SUPA_URL = (import.meta.env.VITE_CLIENT_SUPABASE_URL as string | undefined) || "";

type Cat = "paid" | "hot" | "warm" | "cold" | "unknown";

interface Resp {
  ok: boolean;
  error?: string;
  client?: { name: string; city: string | null; currency: string; website_url: string | null };
  period?: { since: string; days: number };
  totals?: {
    leads: number; scheduled: number; paid: number; purchase_value: number;
    conversion_scheduled: number; conversion_paid: number; conversion_total_to_paid: number;
  };
  quality?: Record<Cat, number>;
  funnel?: Array<{ name: string; value: number; cr: number | null }>;
  weekly?: Array<{ week: string; counts: Record<Cat, number> }>;
  generated_at?: string;
}

const CAT_META: Record<Cat, { label: string; color: string; Icon: typeof Flame }> = {
  paid: { label: "Оплатил", color: "#22c55e", Icon: CheckCircle2 },
  hot: { label: "Горячий", color: "#ef4444", Icon: Flame },
  warm: { label: "Тёплый", color: "#f59e0b", Icon: ThermometerSun },
  cold: { label: "Холодный", color: "#94a3b8", Icon: Snowflake },
  unknown: { label: "Нет данных", color: "#64748b", Icon: Snowflake },
};

const CATS: Cat[] = ["paid", "hot", "warm", "cold"];

export default function ClientDashboard() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token || !SUPA_URL) return;
    setLoading(true);
    fetch(`${SUPA_URL}/functions/v1/client-dashboard?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d: Resp) => setData(d))
      .catch((e) => setData({ ok: false, error: String(e) }))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">Загружаем дашборд…</div>
      </div>
    );
  }

  if (!data || data.error || !data.ok) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md rounded-2xl border border-destructive/40 bg-destructive/5 p-6 text-center">
          <div className="text-lg font-semibold text-destructive">Доступ невозможен</div>
          <div className="mt-2 text-sm text-muted-foreground">
            {data?.error === "expired" ? "Срок действия ссылки истёк." :
              data?.error === "token revoked" ? "Ссылка отозвана." :
              data?.error === "invalid token" ? "Неверная ссылка." :
              data?.error || "Не удалось загрузить данные."}
          </div>
          <div className="mt-3 text-xs text-muted-foreground">Запросите новую ссылку у вашего менеджера.</div>
        </div>
      </div>
    );
  }

  const t = data.totals!;
  const q = data.quality!;
  const maxWeek = Math.max(1, ...(data.weekly ?? []).map((w) =>
    (w.counts.paid + w.counts.hot + w.counts.warm + w.counts.cold)
  ));
  const totalActive = q.paid + q.hot + q.warm + q.cold;

  return (
    <div className="min-h-screen bg-background">
      {/* Шапка */}
      <header className="border-b border-border/60 bg-card/50 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Дашборд клиента · последние {data.period?.days} дн.</div>
            <h1 className="mt-1 text-xl font-bold sm:text-2xl">{data.client?.name}</h1>
            {data.client?.city && <div className="mt-0.5 text-xs text-muted-foreground">{data.client.city}</div>}
          </div>
          <div className="rounded-full bg-primary/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
            MarkVision AI
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        {/* KPI cards */}
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard label="Лидов всего" value={t.leads.toString()} />
          <KpiCard
            label="Записаны на диагностику"
            value={t.scheduled.toString()}
            sub={`CR ${Math.round(t.conversion_scheduled * 100)}% от лидов`}
            tone="hot"
          />
          <KpiCard
            label="Оплатили"
            value={t.paid.toString()}
            sub={`CR ${Math.round(t.conversion_paid * 100)}% от записанных`}
            tone="paid"
          />
          <KpiCard
            label="Выручка"
            value={t.purchase_value > 0
              ? `${Math.round(t.purchase_value).toLocaleString("ru-RU")} ${data.client?.currency || "$"}`
              : "—"
            }
            sub={`Конв. в продажу: ${Math.round(t.conversion_total_to_paid * 100)}%`}
            tone="paid"
          />
        </section>

        {/* Качество */}
        <section className="rounded-2xl border border-border/60 bg-card/40 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Качество лидов</h2>
            <div className="text-xs text-muted-foreground tabular-nums">
              Всего с данными: <span className="font-semibold text-foreground">{totalActive}</span>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {CATS.map((cat) => {
              const meta = CAT_META[cat];
              const v = q[cat];
              const pct = totalActive > 0 ? Math.round((v / totalActive) * 100) : 0;
              return (
                <div key={cat} className="rounded-xl border border-border/60 bg-background/40 p-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="grid h-8 w-8 place-items-center rounded-lg"
                      style={{ background: `${meta.color}22`, color: meta.color }}
                    >
                      <meta.Icon className="h-4 w-4" />
                    </span>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {meta.label}
                    </span>
                  </div>
                  <div className="mt-2 flex items-baseline gap-2 tabular-nums">
                    <div className="text-xl font-bold">{v}</div>
                    <div className="text-[11px] text-muted-foreground">{pct}%</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Гистограмма по неделям */}
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground">
              <span>По неделям (8)</span>
              <div className="flex items-center gap-3">
                {CATS.map((c) => (
                  <span key={c} className="inline-flex items-center gap-1">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: CAT_META[c].color }} />
                    {CAT_META[c].label}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex items-end gap-1.5">
              {(data.weekly ?? []).map(({ week, counts }) => {
                const total = counts.paid + counts.hot + counts.warm + counts.cold;
                const heightPct = total > 0 ? Math.max(8, Math.round((total / maxWeek) * 100)) : 2;
                return (
                  <div key={week} className="flex flex-1 flex-col items-center gap-1" title={`${week}: ${total} лидов`}>
                    <div className="relative w-full overflow-hidden rounded-md bg-secondary/40" style={{ height: 80 }}>
                      <div className="absolute inset-x-0 bottom-0 flex flex-col-reverse" style={{ height: `${heightPct}%` }}>
                        {CATS.map((cat) => counts[cat] > 0 && (
                          <div
                            key={cat}
                            style={{ background: CAT_META[cat].color, flexGrow: counts[cat] }}
                            title={`${CAT_META[cat].label}: ${counts[cat]}`}
                          />
                        ))}
                      </div>
                    </div>
                    <div className="text-[9px] text-muted-foreground">{week.split("-W")[1]}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Воронка */}
        <section className="rounded-2xl border border-border/60 bg-card/40 p-5">
          <h2 className="text-sm font-semibold">Воронка: лид → диагностика → оплата</h2>
          <div className="mt-3 space-y-2">
            {(data.funnel ?? []).map((s) => {
              const max = (data.funnel ?? [])[0]?.value || 1;
              const w = (s.value / Math.max(1, max)) * 100;
              return (
                <div key={s.name}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">{s.name}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {s.value}
                      {s.cr !== null && <span className="ml-2 text-primary">CR {Math.round((s.cr ?? 0) * 100)}%</span>}
                    </span>
                  </div>
                  <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-secondary/60">
                    <div
                      className="h-full"
                      style={{
                        width: `${w}%`,
                        background: s.name.includes("Оплат") ? "#22c55e" : s.name.includes("Записан") ? "#ef4444" : "#94a3b8",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="text-center text-[11px] text-muted-foreground">
          Обновлено: {data.generated_at ? new Date(data.generated_at).toLocaleString("ru-RU") : "—"}
        </div>
      </main>
    </div>
  );
}

function KpiCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "hot" | "paid" }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mt-2 text-2xl font-bold tabular-nums",
        tone === "hot" && "text-destructive",
        tone === "paid" && "text-success",
      )}>
        {value}
      </div>
      {sub && <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
