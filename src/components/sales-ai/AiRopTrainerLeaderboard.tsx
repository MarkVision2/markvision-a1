import { useEffect, useMemo, useState } from "react";
import { Award, Crown, Flame, Medal, Sparkles, Target, Trophy, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import type { TrainerSession } from "@/lib/aiRopStorage";

interface Props {
  projectId: string | null;
  /** Сессии текущего пользователя — для подсветки его строки и расчёта личных бейджей. */
  mySessions: TrainerSession[];
  /** ID текущего пользователя. */
  myUserId: string | null;
}

/** Сырая строка из БД, минимально достаточная для лидерборда. */
interface SessionRow {
  user_id: string;
  score: number | null;
  started_at: string;
  finished_at: string | null;
}

interface UserAggregate {
  userId: string;
  name: string;
  sessionCount: number;
  avgScore: number;
  bestScore: number;
  finishedCount: number;
}

/** Бейдж — описание + условие выдачи + проверка по сессиям. */
export type Badge = {
  id: string;
  title: string;
  hint: string;
  icon: typeof Trophy;
  color: string;
  check: (sessions: TrainerSession[]) => boolean;
};

const BADGES: Badge[] = [
  {
    id: "first_session",
    title: "Первая тренировка",
    hint: "Завершил первый сценарий",
    icon: Sparkles,
    color: "text-primary",
    check: (s) => s.some((x) => x.score !== null),
  },
  {
    id: "perfect_score",
    title: "Идеальный счёт",
    hint: "Получил оценку 100/100",
    icon: Crown,
    color: "text-warning",
    check: (s) => s.some((x) => (x.score ?? 0) >= 100),
  },
  {
    id: "ten_sessions",
    title: "10 тренировок",
    hint: "Закрыл 10 сценариев",
    icon: Medal,
    color: "text-primary",
    check: (s) => s.filter((x) => x.score !== null).length >= 10,
  },
  {
    id: "fifty_sessions",
    title: "50 тренировок",
    hint: "Половина сотни — серьёзный уровень",
    icon: Trophy,
    color: "text-warning",
    check: (s) => s.filter((x) => x.score !== null).length >= 50,
  },
  {
    id: "hundred_sessions",
    title: "100 тренировок",
    hint: "Сотня. Так держать.",
    icon: Award,
    color: "text-warning",
    check: (s) => s.filter((x) => x.score !== null).length >= 100,
  },
  {
    id: "price_master",
    title: "Мастер «дорого»",
    hint: "5 сессий по цене с баллом ≥80",
    icon: Target,
    color: "text-success",
    check: (s) => {
      const matches = s.filter(
        (x) =>
          (x.score ?? 0) >= 80 &&
          /дорог|цен|стои/i.test(x.scenarioTitle),
      );
      return matches.length >= 5;
    },
  },
  {
    id: "streak_3",
    title: "3 дня подряд",
    hint: "Тренировался три дня без перерыва",
    icon: Flame,
    color: "text-destructive",
    check: (s) => hasStreak(s, 3),
  },
  {
    id: "streak_7",
    title: "Недельный стрик",
    hint: "Тренировался семь дней подряд",
    icon: Zap,
    color: "text-warning",
    check: (s) => hasStreak(s, 7),
  },
];

function hasStreak(sessions: TrainerSession[], days: number): boolean {
  if (sessions.length < days) return false;
  const dayKeys = new Set(
    sessions.map((s) => new Date(s.startedAt).toISOString().slice(0, 10)),
  );
  // Ищем любую последовательность из `days` подряд идущих дней.
  const sorted = Array.from(dayKeys).sort();
  for (let i = 0; i <= sorted.length - days; i++) {
    const start = new Date(sorted[i] + "T00:00:00Z");
    let ok = true;
    for (let d = 0; d < days; d++) {
      const expected = new Date(start.getTime() + d * 86400000)
        .toISOString()
        .slice(0, 10);
      if (!dayKeys.has(expected)) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

export function AiRopTrainerLeaderboard({ projectId, mySessions, myUserId }: Props) {
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setRows([]);
      setNames(new Map());
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      // Берём только финальные сессии (с оценкой) за 30 дней.
      const { data, error } = await supabase
        .from("ai_rop_trainer_sessions")
        .select("user_id, score, started_at, finished_at")
        .eq("project_id", projectId)
        .gte("started_at", since)
        .not("score", "is", null)
        .limit(2000);
      if (cancelled) return;
      if (error) {
        console.warn("[trainer leaderboard] load failed:", error.message);
        setRows([]);
      } else {
        const list = (data ?? []) as SessionRow[];
        setRows(list);
        // Достаём имена участников из profiles одним запросом
        const userIds = Array.from(new Set(list.map((r) => r.user_id)));
        if (userIds.length) {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, name, login")
            .in("id", userIds);
          if (!cancelled && profiles) {
            const m = new Map<string, string>();
            for (const p of profiles as Array<{ id: string; name: string | null; login: string | null }>) {
              m.set(p.id, p.name || p.login || p.id.slice(0, 6));
            }
            setNames(m);
          }
        }
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const aggregates = useMemo<UserAggregate[]>(() => {
    const byUser = new Map<string, { sum: number; count: number; best: number }>();
    for (const r of rows) {
      const s = r.score ?? 0;
      const cur = byUser.get(r.user_id) ?? { sum: 0, count: 0, best: 0 };
      cur.sum += s;
      cur.count += 1;
      cur.best = Math.max(cur.best, s);
      byUser.set(r.user_id, cur);
    }
    return Array.from(byUser.entries())
      .map(([userId, v]) => ({
        userId,
        name: names.get(userId) || userId.slice(0, 6),
        sessionCount: v.count,
        avgScore: Math.round(v.sum / v.count),
        bestScore: v.best,
        finishedCount: v.count,
      }))
      .sort((a, b) => b.avgScore - a.avgScore || b.sessionCount - a.sessionCount)
      .slice(0, 10);
  }, [rows, names]);

  const myBadges = useMemo(() => BADGES.filter((b) => b.check(mySessions)), [mySessions]);
  const lockedBadges = useMemo(() => BADGES.filter((b) => !b.check(mySessions)), [mySessions]);

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_320px]">
      {/* Лидерборд */}
      <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Trophy className="h-4 w-4 text-warning" />
          <h3 className="text-sm font-bold">Лидерборд команды — 30 дней</h3>
          {loading && <span className="text-[10px] text-muted-foreground">загрузка…</span>}
        </div>
        {!projectId ? (
          <Empty text="Выберите проект, чтобы увидеть рейтинг команды" />
        ) : aggregates.length === 0 ? (
          <Empty text="Никто из команды ещё не закрыл сценарий. Будь первым!" />
        ) : (
          <div className="space-y-1">
            {aggregates.map((u, idx) => {
              const isMe = myUserId && u.userId === myUserId;
              const medal =
                idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `${idx + 1}.`;
              return (
                <div
                  key={u.userId}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border p-2 text-xs",
                    isMe
                      ? "border-primary/50 bg-primary/10"
                      : "border-border/40 bg-background/40",
                  )}
                >
                  <span className="w-6 text-center text-sm font-bold">{medal}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">
                      {u.name}
                      {isMe && (
                        <span className="ml-1 text-[10px] font-normal text-primary">— вы</span>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {u.sessionCount} тренировок · лучший балл {u.bestScore}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-base font-bold tabular-nums">{u.avgScore}</div>
                    <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
                      средний
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Бейджи */}
      <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Award className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold">Мои достижения</h3>
          <span className="ml-auto text-[10px] text-muted-foreground">
            {myBadges.length}/{BADGES.length}
          </span>
        </div>
        {myBadges.length === 0 ? (
          <Empty text="Завершите первую тренировку, чтобы получить первый бейдж" />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {myBadges.map((b) => (
              <BadgeTile key={b.id} badge={b} earned />
            ))}
          </div>
        )}
        {lockedBadges.length > 0 && (
          <>
            <div className="mt-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Ещё можно открыть
            </div>
            <div className="mt-1 grid grid-cols-2 gap-2 opacity-50">
              {lockedBadges.slice(0, 4).map((b) => (
                <BadgeTile key={b.id} badge={b} earned={false} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function BadgeTile({ badge, earned }: { badge: Badge; earned: boolean }) {
  const Icon = badge.icon;
  return (
    <div
      className={cn(
        "rounded-lg border p-2 text-[10px]",
        earned
          ? "border-border/40 bg-background/40"
          : "border-dashed border-border/40 bg-secondary/20",
      )}
    >
      <Icon
        className={cn(
          "h-4 w-4",
          earned ? badge.color : "text-muted-foreground",
        )}
      />
      <div className="mt-1 font-semibold leading-tight">{badge.title}</div>
      <div className="text-[9px] leading-snug text-muted-foreground">{badge.hint}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border/60 bg-secondary/20 p-4 text-center text-[11px] text-muted-foreground">
      {text}
    </div>
  );
}
