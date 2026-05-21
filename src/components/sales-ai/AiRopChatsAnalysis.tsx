import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Heart,
  MessageSquare,
  Search,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Lead } from "@/types/crm";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  leads: Lead[];
  projectId: string | null;
}

interface ChatAnalysisRow {
  id: string;
  lead_id: string | null;
  channel: string | null;
  message_count: number | null;
  first_response_min: number | null;
  avg_response_min: number | null;
  overall_score: number | null;
  topics: string[] | null;
  objections: string[] | null;
  strengths: string[] | null;
  weaknesses: string[] | null;
  flag_price_without_qualification: boolean | null;
  flag_no_closing: boolean | null;
  flag_ghosted_by_manager: boolean | null;
  processed_at: string;
}

export function AiRopChatsAnalysis({ leads, projectId }: Props) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<ChatAnalysisRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      const { data, error } = await supabase
        .from("ai_rop_chat_analyses")
        .select(
          "id, lead_id, channel, message_count, first_response_min, avg_response_min, overall_score, topics, objections, strengths, weaknesses, flag_price_without_qualification, flag_no_closing, flag_ghosted_by_manager, processed_at",
        )
        .eq("project_id", projectId)
        .gte("processed_at", since)
        .order("processed_at", { ascending: false })
        .limit(500);
      if (cancelled) return;
      if (error) {
        console.error("[AiRopChatsAnalysis] load error", error);
        setRows([]);
      } else {
        setRows((data ?? []) as ChatAnalysisRow[]);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const stats = useMemo(() => {
    const total = rows.length;
    const scored = rows.filter((r) => typeof r.overall_score === "number");
    const avgScore = scored.length
      ? Math.round(scored.reduce((s, r) => s + (r.overall_score ?? 0), 0) / scored.length)
      : 0;
    const respMins = rows
      .map((r) => r.first_response_min)
      .filter((v): v is number => typeof v === "number" && v >= 0);
    const avgResponseMin = respMins.length
      ? Math.round(respMins.reduce((s, v) => s + v, 0) / respMins.length)
      : 0;
    const ghosted = rows.filter((r) => r.flag_ghosted_by_manager).length;
    const noClosing = rows.filter((r) => r.flag_no_closing).length;
    const priceWithoutQual = rows.filter((r) => r.flag_price_without_qualification).length;
    return { total, avgScore, avgResponseMin, ghosted, noClosing, priceWithoutQual };
  }, [rows]);

  const topTopics = useMemo(() => {
    const counter = new Map<string, number>();
    for (const r of rows) {
      for (const t of r.topics ?? []) {
        const key = (t ?? "").trim();
        if (!key) continue;
        counter.set(key, (counter.get(key) ?? 0) + 1);
      }
    }
    const arr = Array.from(counter.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
    const max = arr[0]?.count ?? 1;
    return arr.map((t) => ({ ...t, share: Math.round((t.count / max) * 100) }));
  }, [rows]);

  const recent = rows.slice(0, 3);
  const leadById = useMemo(() => {
    const map = new Map<string, Lead>();
    for (const l of leads) map.set(l.id, l);
    return map;
  }, [leads]);

  return (
    <div className="space-y-4">
      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Чатов разобрано" value={String(stats.total)} icon={MessageSquare} />
        <Tile
          label="Сред. оценка"
          value={stats.total ? `${stats.avgScore}/100` : "—"}
          icon={CheckCircle2}
          tone={stats.avgScore >= 70 ? "success" : stats.avgScore >= 50 ? "warning" : "destructive"}
        />
        <Tile
          label="Менеджер слил"
          value={String(stats.ghosted)}
          icon={AlertTriangle}
          tone="destructive"
        />
        <Tile
          label="Сред. время ответа"
          value={stats.avgResponseMin > 0 ? `${stats.avgResponseMin} мин` : "—"}
          icon={Clock}
        />
      </div>

      {/* Что анализирует */}
      <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/30">
            <Search className="h-4 w-4" />
          </span>
          <div className="flex-1">
            <h3 className="text-sm font-bold">Что ИИ-РОП проверяет в чатах</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              РОП получает все переписки в реальном времени через интеграции
              и для каждого диалога считает:
            </p>
            <div className="mt-2 grid grid-cols-1 gap-1.5 md:grid-cols-2">
              {CHECKLIST.map((c, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[11px]">
                  <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-success" />
                  <span>{c}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Флаги */}
      {stats.total > 0 && (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <FlagTile
            label="Прайс без квалификации"
            count={stats.priceWithoutQual}
            total={stats.total}
          />
          <FlagTile label="Не закрыл на след. шаг" count={stats.noClosing} total={stats.total} />
          <FlagTile
            label="Менеджер бросил диалог"
            count={stats.ghosted}
            total={stats.total}
          />
        </div>
      )}

      {/* Последние разборы */}
      <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold">Последние разборы переписок</h3>
          {loading && <span className="text-[10px] text-muted-foreground">загрузка…</span>}
        </div>
        {recent.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-secondary/20 p-6 text-center text-xs text-muted-foreground">
            Пока нет разобранных чатов. РОП анализирует новые переписки автоматически.
          </div>
        ) : (
          <div className="space-y-2">
            {recent.map((r) => {
              const lead = r.lead_id ? leadById.get(r.lead_id) : null;
              const score = r.overall_score ?? 0;
              const tone =
                score >= 70 ? "text-success" : score >= 50 ? "text-warning" : "text-destructive";
              return (
                <div
                  key={r.id}
                  className="flex items-center gap-3 rounded-xl border border-border/40 bg-background/40 p-3"
                >
                  <MessageSquare className="h-7 w-7 shrink-0 text-success" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">
                      {lead?.name ?? "Без имени"} · {r.channel ?? "chat"}
                    </div>
                    <div className="truncate text-[10px] text-muted-foreground">
                      {r.message_count ?? 0} сообщ.{" "}
                      {r.first_response_min != null && `· ответ ${r.first_response_min} мин `}
                      {r.topics && r.topics.length > 0 && `· ${r.topics.slice(0, 2).join(", ")}`}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={cn("text-xl font-bold tabular-nums", tone)}>{score}</div>
                    <div className="text-[10px] text-muted-foreground">/100</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Топ тем разговоров */}
      <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Heart className="h-4 w-4 text-pink-400" />
          <h3 className="text-sm font-bold">Топ тем и возражений из чатов</h3>
          <span className="text-[10px] text-muted-foreground">за 30 дней</span>
        </div>
        {topTopics.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-secondary/20 p-4 text-center text-xs text-muted-foreground">
            Темы появятся, как только РОП обработает первые чаты.
          </div>
        ) : (
          <div className="space-y-2">
            {topTopics.map((t, i) => (
              <div key={i} className="rounded-lg border border-border/40 bg-background/40 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold">{t.label}</span>
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {t.count} раз
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary/60">
                    <div className="h-full bg-primary" style={{ width: `${t.share}%` }} />
                  </div>
                  <button
                    onClick={() => navigate("/sales-ai?tab=content")}
                    className="shrink-0 text-[10px] font-semibold text-primary hover:underline"
                  >
                    → контент
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-3 rounded-xl border border-dashed border-border/60 bg-secondary/20 p-2 text-[11px] text-muted-foreground">
          💡 РОП собирает темы из реальных чатов и автоматически предлагает идеи контент-плана.
        </div>
      </div>
    </div>
  );
}

const CHECKLIST = [
  "Время первого ответа на сообщение",
  "Использование скриптов из библиотеки",
  "Эмпатия, тон и грамотность",
  "Отработка возражений в переписке",
  "Закрывает ли менеджер на следующий шаг",
  "Отправляет ли прайс без квалификации",
  "Пишет ли follow-up при молчании",
  "Не теряет ли лида в чате",
];

function Tile({
  label,
  value,
  icon: Icon,
  tone = "primary",
}: {
  label: string;
  value: string;
  icon: typeof MessageSquare;
  tone?: "primary" | "success" | "warning" | "destructive";
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
      <span
        className={cn(
          "grid h-9 w-9 place-items-center rounded-xl ring-1",
          tone === "primary" && "bg-primary/15 text-primary ring-primary/30",
          tone === "success" && "bg-success/15 text-success ring-success/30",
          tone === "warning" && "bg-warning/15 text-warning ring-warning/30",
          tone === "destructive" && "bg-destructive/15 text-destructive ring-destructive/30",
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function FlagTile({ label, count, total }: { label: string; count: number; total: number }) {
  const pct = total ? Math.round((count / total) * 100) : 0;
  const tone =
    pct >= 30 ? "destructive" : pct >= 15 ? "warning" : "success";
  const Icon = tone === "success" ? TrendingUp : TrendingDown;
  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-muted-foreground">{label}</span>
        <Icon
          className={cn(
            "h-3.5 w-3.5",
            tone === "destructive" && "text-destructive",
            tone === "warning" && "text-warning",
            tone === "success" && "text-success",
          )}
        />
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-2xl font-bold tabular-nums">{count}</span>
        <span className="text-[10px] text-muted-foreground">из {total} · {pct}%</span>
      </div>
    </div>
  );
}
