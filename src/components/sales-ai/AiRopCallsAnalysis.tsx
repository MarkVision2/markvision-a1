import { useMemo } from "react";
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
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Lead } from "@/types/crm";

interface Props {
  leads: Lead[];
}

export function AiRopCallsAnalysis({ leads }: Props) {
  const navigate = useNavigate();

  const stats = useMemo(() => {
    let total = 0;
    let answered = 0;
    let totalDur = 0;
    for (const l of leads) {
      for (const e of l.events ?? []) {
        if (e.type === "call_made") {
          total += 1;
          answered += 1;
          const dur = Number(e.payload?.duration ?? 0);
          totalDur += dur;
        } else if (e.type === "call_attempt") {
          total += 1;
        }
      }
    }
    const missed = total - answered;
    const avgDurSec = answered ? Math.round(totalDur / answered) : 0;
    return { total, answered, missed, avgDurSec };
  }, [leads]);

  const recent = useMemo(() => {
    const items: { leadId: string; leadName: string; at: string; type: string }[] = [];
    for (const l of leads) {
      for (const e of l.events ?? []) {
        if (e.type === "call_made" || e.type === "call_attempt") {
          items.push({ leadId: l.id, leadName: l.name, at: e.at, type: e.type });
        }
      }
    }
    return items.sort((a, b) => +new Date(b.at) - +new Date(a.at)).slice(0, 10);
  }, [leads]);

  return (
    <div className="space-y-4">
      {/* KPI tiles */}
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
          label="Сред. длительность"
          value={stats.avgDurSec > 0 ? formatDur(stats.avgDurSec) : "—"}
          icon={Clock}
        />
      </div>

      {/* Зачем нужна интеграция */}
      <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/30">
            <Mic className="h-4 w-4" />
          </span>
          <div className="flex-1">
            <h3 className="text-sm font-bold">Анализ разговоров: что подключим</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              При подключённой телефонии (Sipuni / Mango / Beeline) РОП автоматически:
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

      {/* Превью разбора (демо) */}
      <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold">Пример разбора звонка</h3>
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
            демо
          </span>
        </div>
        <DemoCallReport />
      </div>

      {/* Последние звонки */}
      <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
        <div className="mb-3 flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-bold">Последние звонки</h3>
          <button
            onClick={() => navigate("/calls")}
            className="ml-auto inline-flex items-center gap-1 rounded-lg border border-border/60 px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
          >
            Все звонки <ArrowRight className="h-3 w-3" />
          </button>
        </div>
        {recent.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-secondary/20 p-6 text-center text-[11px] text-muted-foreground">
            Звонков пока нет. Подключите телефонию, чтобы РОП их видел.
          </div>
        ) : (
          <div className="space-y-1.5">
            {recent.map((r, idx) => (
              <button
                key={idx}
                onClick={() => navigate(`/crm?lead=${r.leadId}`)}
                className="flex w-full items-center gap-2 rounded-xl border border-border/60 bg-background/40 p-2 text-left hover:bg-secondary/60"
              >
                <span
                  className={cn(
                    "grid h-7 w-7 place-items-center rounded-full",
                    r.type === "call_made"
                      ? "bg-success/15 text-success"
                      : "bg-warning/15 text-warning",
                  )}
                >
                  <Phone className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold">{r.leadName}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {new Date(r.at).toLocaleString("ru-RU")}
                  </div>
                </div>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-bold",
                    r.type === "call_made"
                      ? "bg-success/15 text-success"
                      : "bg-warning/15 text-warning",
                  )}
                >
                  {r.type === "call_made" ? "успешно" : "попытка"}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
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

function DemoCallReport() {
  const criteria = [
    { name: "Приветствие по скрипту", score: 90, note: "Назвал имя и клинику" },
    { name: "Сбор информации о пациенте", score: 60, note: "Не уточнил возраст и историю" },
    { name: "Отработка возражения «дорого»", score: 35, note: "Сразу скинул скидку" },
    { name: "Эмпатия и тон", score: 75, note: "Спокойный, дружелюбный" },
    { name: "Закрытие на следующий шаг", score: 100, note: "Назначил время визита" },
  ];
  const overall = Math.round(criteria.reduce((s, c) => s + c.score, 0) / criteria.length);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-xl border border-border/40 bg-background/40 p-3">
        <FileAudio className="h-8 w-8 text-primary" />
        <div className="flex-1">
          <div className="text-sm font-semibold">Айгерим • Заявка из Instagram</div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <Volume2 className="h-3 w-3" /> 4:32 · 12 мая, 14:08
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold tabular-nums text-warning">{overall}/100</div>
          <div className="text-[10px] text-muted-foreground">общая оценка</div>
        </div>
      </div>

      <div className="space-y-1.5">
        {criteria.map((c, i) => {
          const tone = c.score >= 80 ? "success" : c.score >= 50 ? "warning" : "destructive";
          return (
            <div key={i} className="rounded-lg border border-border/40 bg-background/40 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold">{c.name}</span>
                <span
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                    tone === "success" && "bg-success/15 text-success",
                    tone === "warning" && "bg-warning/15 text-warning",
                    tone === "destructive" && "bg-destructive/15 text-destructive",
                  )}
                >
                  {c.score}
                </span>
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">{c.note}</div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-secondary/60">
                <div
                  className={cn(
                    "h-full",
                    tone === "success" && "bg-success",
                    tone === "warning" && "bg-warning",
                    tone === "destructive" && "bg-destructive",
                  )}
                  style={{ width: `${c.score}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3">
        <div className="flex items-center gap-2 text-xs font-bold text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" />
          Главная ошибка
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Когда пациентка сказала «дорого», менеджер сразу предложил скидку. Это снижает
          воспринимаемую ценность услуги и закладывает торг на будущих этапах.
          Правильно: уточнить, с чем сравнивает, обосновать стоимость диагностики и состав услуги.
        </p>
      </div>

      <div className="rounded-xl border border-success/40 bg-success/10 p-3">
        <div className="flex items-center gap-2 text-xs font-bold text-success">
          <TrendingUp className="h-3.5 w-3.5" />
          Что сработало
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Чётко обозначил следующий шаг и предложил конкретный слот — пациентка согласилась.
          Этот приём добавим в библиотеку скриптов.
        </p>
      </div>
    </div>
  );
}

function formatDur(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
