import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
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

interface Props {
  leads: Lead[];
}

export function AiRopChatsAnalysis({ leads }: Props) {
  const navigate = useNavigate();

  const stats = useMemo(() => {
    const withChat = leads.filter((l) => l.channel === "whatsapp" || l.channel === "telegram" || l.channel === "instagram");
    const responded = leads.filter((l) => l.firstResponseAt);
    const avgResponseMin =
      responded.length === 0
        ? 0
        : Math.round(
            responded.reduce((sum, l) => {
              const diff = Math.max(
                0,
                (new Date(l.firstResponseAt!).getTime() - new Date(l.createdAt).getTime()) / 60000,
              );
              return sum + diff;
            }, 0) / responded.length,
          );
    return {
      totalChats: withChat.length,
      responded: responded.length,
      avgResponseMin,
      ghosted: leads.filter((l) => !l.firstResponseAt && l.stageId === "new").length,
    };
  }, [leads]);

  return (
    <div className="space-y-4">
      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Чатов в работе" value={String(stats.totalChats)} icon={MessageSquare} />
        <Tile
          label="Отвечено"
          value={String(stats.responded)}
          icon={CheckCircle2}
          tone="success"
        />
        <Tile
          label="Без ответа"
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
              Через GreenAPI РОП получает все переписки WhatsApp в реальном времени
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

      {/* Демо разбора чата */}
      <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold">Пример разбора переписки</h3>
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
            демо
          </span>
        </div>
        <DemoChatReport />
      </div>

      {/* Топ тем разговоров */}
      <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Heart className="h-4 w-4 text-pink-400" />
          <h3 className="text-sm font-bold">Топ тем и возражений из чатов</h3>
          <span className="text-[10px] text-muted-foreground">за последние 30 дней</span>
        </div>
        <div className="space-y-2">
          {TOP_TOPICS.map((t, i) => (
            <div key={i} className="rounded-lg border border-border/40 bg-background/40 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold">{t.label}</span>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {t.count} раз · {t.share}%
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

const TOP_TOPICS = [
  { label: "Сколько стоит имплантация?", count: 24, share: 80 },
  { label: "Что входит в диагностику?", count: 18, share: 60 },
  { label: "Срок лечения и сроки реабилитации", count: 12, share: 40 },
  { label: "Есть ли рассрочка?", count: 9, share: 30 },
  { label: "Какие материалы используете?", count: 6, share: 20 },
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

function DemoChatReport() {
  const messages = [
    { from: "lead", text: "Здравствуйте! Сколько стоит имплант?", at: "14:02" },
    {
      from: "manager",
      text: "Здравствуйте! Имплант под ключ — 250 000 ₸",
      at: "14:18",
      flag: "Сразу прайс без квалификации",
    },
    { from: "lead", text: "Это дорого. У других дешевле", at: "14:25" },
    { from: "manager", text: "А сколько вы видели?", at: "14:31", flag: "Хорошо: уточнил" },
    { from: "lead", text: "180 000 в Аруна-Дент", at: "14:35" },
    {
      from: "manager",
      text: "У нас входит еще КТ и план лечения. Хотите запишемся на диагностику?",
      at: "14:42",
      good: true,
    },
  ];
  const score = 55;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-xl border border-border/40 bg-background/40 p-3">
        <MessageSquare className="h-8 w-8 text-success" />
        <div className="flex-1">
          <div className="text-sm font-semibold">Айдар • WhatsApp</div>
          <div className="text-[10px] text-muted-foreground">
            6 сообщений · ответ на 16 мин (норма 5 мин)
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold tabular-nums text-warning">{score}/100</div>
          <div className="text-[10px] text-muted-foreground">оценка</div>
        </div>
      </div>

      <div className="space-y-1.5">
        {messages.map((m, i) => (
          <div
            key={i}
            className={cn("flex gap-2", m.from === "manager" ? "flex-row-reverse" : "flex-row")}
          >
            <div
              className={cn(
                "max-w-[80%] rounded-2xl px-3 py-1.5 text-xs",
                m.from === "manager"
                  ? "bg-primary/15"
                  : "border border-border/60 bg-background/40",
              )}
            >
              <div>{m.text}</div>
              <div className="mt-0.5 flex items-center gap-1 text-[9px] text-muted-foreground">
                {m.at}
                {m.flag && (
                  <span
                    className={cn(
                      "rounded-md px-1 py-0.5 font-bold",
                      m.good
                        ? "bg-success/20 text-success"
                        : "bg-warning/20 text-warning",
                    )}
                  >
                    {m.flag}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <div className="rounded-xl border border-warning/40 bg-warning/10 p-3">
          <div className="flex items-center gap-2 text-xs font-bold text-warning">
            <TrendingDown className="h-3.5 w-3.5" />
            Слабые места
          </div>
          <ul className="mt-1 space-y-1 text-[11px] text-muted-foreground">
            <li>• Прайс без квалификации в первом ответе</li>
            <li>• Ответ через 16 минут — выше нормы</li>
            <li>• Не уточнил, какой именно зуб нужно восстановить</li>
          </ul>
        </div>
        <div className="rounded-xl border border-success/40 bg-success/10 p-3">
          <div className="flex items-center gap-2 text-xs font-bold text-success">
            <TrendingUp className="h-3.5 w-3.5" />
            Сильные места
          </div>
          <ul className="mt-1 space-y-1 text-[11px] text-muted-foreground">
            <li>• Уточнил сравнение с конкурентом</li>
            <li>• Обосновал ценность диагностики</li>
            <li>• Закрыл на следующий шаг — визит</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
