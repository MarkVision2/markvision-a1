import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  FileAudio,
  History,
  Mic,
  Phone,
  Sparkles,
  TrendingUp,
  Volume2,
  X,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Lead } from "@/types/crm";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  leads: Lead[];
  projectId: string | null;
}

interface CallRow {
  id: string;
  lead_id: string | null;
  manager_id: string | null;
  call_at: string;
  duration_sec: number | null;
  overall_score: number | null;
  main_mistake: string | null;
  topics: string[] | null;
  strengths: string[] | null;
  weaknesses: string[] | null;
  objections: string[] | null;
  criteria: unknown;
  call_recording_url: string | null;
  transcript: string | null;
  processed_at: string;
}

export function AiRopCallsAnalysis({ leads, projectId }: Props) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<CallRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<CallRow | null>(null);

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
        .from("ai_rop_call_analyses")
        .select(
          "id, lead_id, manager_id, call_at, duration_sec, overall_score, main_mistake, topics, strengths, weaknesses, objections, criteria, call_recording_url, transcript, processed_at",
        )
        .eq("project_id", projectId)
        .gte("call_at", since)
        .order("call_at", { ascending: false })
        .limit(500);
      if (cancelled) return;
      if (error) {
        console.error("[AiRopCallsAnalysis] load error", error);
        setRows([]);
      } else {
        setRows((data ?? []) as CallRow[]);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const leadById = useMemo(() => {
    const m = new Map<string, Lead>();
    for (const l of leads) m.set(l.id, l);
    return m;
  }, [leads]);

  const stats = useMemo(() => {
    const total = rows.length;
    const answered = rows.filter((r) => (r.duration_sec ?? 0) > 0).length;
    const missed = total - answered;
    const scored = rows.filter((r) => typeof r.overall_score === "number");
    const avgScore = scored.length
      ? Math.round(scored.reduce((s, r) => s + (r.overall_score ?? 0), 0) / scored.length)
      : 0;
    const durs = rows.map((r) => r.duration_sec ?? 0).filter((d) => d > 0);
    const avgDurSec = durs.length ? Math.round(durs.reduce((s, d) => s + d, 0) / durs.length) : 0;
    return { total, answered, missed, avgScore, avgDurSec };
  }, [rows]);

  const recent = rows.slice(0, 5);
  const hasData = rows.length > 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Всего звонков" value={String(stats.total)} icon={Phone} />
        <Tile
          label="Отвечено"
          value={String(stats.answered)}
          icon={CheckCircle2}
          tone="success"
        />
        <Tile label="Не дозвон" value={String(stats.missed)} icon={XCircle} tone="warning" />
        <Tile
          label="Сред. оценка"
          value={stats.avgScore > 0 ? `${stats.avgScore}/100` : "—"}
          icon={Sparkles}
          tone={
            stats.avgScore >= 70 ? "success" : stats.avgScore >= 50 ? "warning" : "destructive"
          }
        />
      </div>

      {!hasData && (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/30">
              <Mic className="h-4 w-4" />
            </span>
            <div className="flex-1">
              <h3 className="text-sm font-bold">Анализ разговоров: что подключим</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Подключите Sipuni — РОП автоматически разберёт каждый звонок:
              </p>
              <div className="mt-2 grid grid-cols-1 gap-1.5 md:grid-cols-2">
                {CHECKLIST.map((c, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-[11px]">
                    <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-success" />
                    <span>{c}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => navigate("/settings/connection")}
                className="mt-3 inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
              >
                Подключить телефонию
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
        <div className="mb-3 flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-bold">Последние разборы звонков</h3>
          {loading && <span className="text-[10px] text-muted-foreground">загрузка…</span>}
        </div>
        {recent.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-secondary/20 p-6 text-center text-[11px] text-muted-foreground">
            Разборов пока нет. РОП обработает звонки автоматически после подключения телефонии.
          </div>
        ) : (
          <div className="space-y-1.5">
            {recent.map((r) => {
              const lead = r.lead_id ? leadById.get(r.lead_id) : null;
              const score = r.overall_score ?? 0;
              const tone =
                score >= 70 ? "success" : score >= 50 ? "warning" : "destructive";
              return (
                <button
                  key={r.id}
                  onClick={() => setSelected(r)}
                  className="flex w-full items-center gap-2 rounded-xl border border-border/60 bg-background/40 p-2 text-left hover:bg-secondary/60"
                >
                  <span
                    className={cn(
                      "grid h-7 w-7 place-items-center rounded-full",
                      tone === "success" && "bg-success/15 text-success",
                      tone === "warning" && "bg-warning/15 text-warning",
                      tone === "destructive" && "bg-destructive/15 text-destructive",
                    )}
                  >
                    <Phone className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold">
                      {lead?.name ?? "Без имени"}
                      {r.topics && r.topics.length > 0 && (
                        <span className="ml-1 text-muted-foreground">
                          · {r.topics.slice(0, 2).join(", ")}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {new Date(r.call_at).toLocaleString("ru-RU")}
                      {r.duration_sec ? ` · ${formatDur(r.duration_sec)}` : ""}
                    </div>
                  </div>
                  <span
                    className={cn(
                      "rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                      tone === "success" && "bg-success/15 text-success",
                      tone === "warning" && "bg-warning/15 text-warning",
                      tone === "destructive" && "bg-destructive/15 text-destructive",
                    )}
                  >
                    {score}/100
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selected && (
        <CallDetailModal
          row={selected}
          leadName={selected.lead_id ? leadById.get(selected.lead_id)?.name : undefined}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

const CHECKLIST = [
  "Запишет разговор и сохранит в карточку лида",
  "Расшифрует речь через Whisper",
  "Проверит соблюдение скрипта",
  "Оценит эмпатию и тон администратора",
  "Найдёт возражения и как их отработали",
  "Отметит, был ли назначен следующий шаг",
  "Поставит оценку 0-100 и даст рекомендации",
  "Сохранит лучшие фразы в библиотеку",
];

function Tile({
  label,
  value,
  icon: Icon,
  tone = "primary",
}: {
  label: string;
  value: string;
  icon: typeof Phone;
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

function CallDetailModal({
  row,
  leadName,
  onClose,
}: {
  row: CallRow;
  leadName?: string;
  onClose: () => void;
}) {
  const criteria = Array.isArray(row.criteria)
    ? (row.criteria as Array<{ name?: string; score?: number; note?: string }>)
    : [];
  const score = row.overall_score ?? 0;
  const tone = score >= 70 ? "success" : score >= 50 ? "warning" : "destructive";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4 backdrop-blur">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border/60 bg-card p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <FileAudio className="h-8 w-8 text-primary" />
            <div>
              <div className="text-sm font-bold">{leadName ?? "Без имени"}</div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <Volume2 className="h-3 w-3" />
                {row.duration_sec ? formatDur(row.duration_sec) : "—"} ·{" "}
                {new Date(row.call_at).toLocaleString("ru-RU")}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div
                className={cn(
                  "text-3xl font-bold tabular-nums",
                  tone === "success" && "text-success",
                  tone === "warning" && "text-warning",
                  tone === "destructive" && "text-destructive",
                )}
              >
                {score}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                /100
              </div>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {criteria.length > 0 && (
          <div className="space-y-1.5">
            {criteria.map((c, i) => {
              const s = Number(c.score) || 0;
              const t = s >= 70 ? "success" : s >= 50 ? "warning" : "destructive";
              return (
                <div key={i} className="rounded-lg border border-border/40 bg-background/40 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold">{c.name ?? "—"}</span>
                    <span
                      className={cn(
                        "rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                        t === "success" && "bg-success/15 text-success",
                        t === "warning" && "bg-warning/15 text-warning",
                        t === "destructive" && "bg-destructive/15 text-destructive",
                      )}
                    >
                      {s}
                    </span>
                  </div>
                  {c.note && (
                    <div className="mt-1 text-[10px] text-muted-foreground">{c.note}</div>
                  )}
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-secondary/60">
                    <div
                      className={cn(
                        "h-full",
                        t === "success" && "bg-success",
                        t === "warning" && "bg-warning",
                        t === "destructive" && "bg-destructive",
                      )}
                      style={{ width: `${Math.min(100, s)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {row.main_mistake && (
          <div className="mt-3 rounded-xl border border-destructive/40 bg-destructive/10 p-3">
            <div className="flex items-center gap-2 text-xs font-bold text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" />
              Главная ошибка
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">{row.main_mistake}</p>
          </div>
        )}

        {row.strengths && row.strengths.length > 0 && (
          <div className="mt-3 rounded-xl border border-success/40 bg-success/10 p-3">
            <div className="flex items-center gap-2 text-xs font-bold text-success">
              <TrendingUp className="h-3.5 w-3.5" />
              Что сработало
            </div>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
              {row.strengths.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </div>
        )}

        {row.weaknesses && row.weaknesses.length > 0 && (
          <div className="mt-3 rounded-xl border border-warning/40 bg-warning/10 p-3">
            <div className="text-xs font-bold text-warning">Что улучшить</div>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
              {row.weaknesses.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </div>
        )}

        {row.call_recording_url && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-border/40 bg-background/40 p-2 text-[11px]">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <a
              href={row.call_recording_url}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-primary hover:underline"
            >
              Послушать запись
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function formatDur(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
