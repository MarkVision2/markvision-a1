import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Crosshair,
  ExternalLink,
  Globe,
  Instagram,
  Loader2,
  MessageCircle,
  Phone,
  RefreshCw,
  Star,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtNum } from "@/lib/format";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import {
  useLeadgen,
  type LeadgenAnswer,
  type LeadgenAnswerKind,
} from "@/hooks/useLeadgen";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/* ────────────────────────────────────────────────────────────
   Шкала для баров воронки: один оттенок, светлее → темнее.
   Ординальная, не категориальная — стадии упорядочены.
   ──────────────────────────────────────────────────────────── */
const RAMP = [
  "#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7",
  "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95",
];

const digits = (s: string | null | undefined) => String(s ?? "").replace(/\D/g, "");
const waLink = (s: string | null | undefined) => {
  const d = digits(s);
  return d ? `https://wa.me/${d}` : null;
};
const shortDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
const share = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : "—");

/* ── Балл лида: цвет всегда идёт со словом, чтобы не читаться цветом одним ── */
function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-xs text-muted-foreground">—</span>;
  const [color, label] =
    score >= 75 ? ["#0ca30c", "горячий"] :
    score >= 60 ? ["#fab219", "тёплый"] :
    score >= 45 ? ["#ec835a", "прохладный"] :
                  ["#d03b3b", "холодный"];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
      <i className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: color }} />
      {score} · {label}
    </span>
  );
}

function KindBadge({ kind }: { kind: LeadgenAnswerKind }) {
  const map: Record<LeadgenAnswerKind, string> = {
    "ответил": "#0ca30c",
    "кликнул": "#fab219",
    "тишина": "#898781",
  };
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
      <i className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: map[kind] }} />
      {kind}
    </span>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/60 p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1.5 text-2xl font-bold tabular-nums">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

function Panel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border/60 bg-card/40 p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function BarRow({ label, value, max, color, right }: {
  label: string; value: number; max: number; color: string; right?: string;
}) {
  const width = max > 0 ? Math.max(value > 0 ? 2 : 0, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-40 shrink-0 truncate text-xs text-muted-foreground sm:w-48">{label}</div>
      <div className="flex flex-1 items-center gap-2.5">
        <div
          className="h-3.5 rounded-r"
          style={{ width: `${width}%`, minWidth: 2, background: color }}
          title={`${label}: ${fmtNum(value)}`}
        />
        <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
          {right ?? fmtNum(value)}
        </span>
      </div>
    </div>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="py-3 text-sm text-muted-foreground">{children}</p>
);

/* ────────────────────────────────────────────────────────────
   Страница
   ──────────────────────────────────────────────────────────── */
const Leadgen = () => {
  const { activeId } = useProjectsStore();
  const { data, loading, error, refetch } = useLeadgen(activeId || null);
  const [answerFilter, setAnswerFilter] = useState<"все" | LeadgenAnswerKind>("все");

  const F = data.funnel;
  const AS = data.answers_stat;

  const maxStage = useMemo(
    () => Math.max(1, ...data.stages.map((s) => s.cnt)),
    [data.stages],
  );
  const maxSegment = useMemo(
    () => Math.max(1, ...data.segments.map((s) => s.лидов)),
    [data.segments],
  );

  const answers = useMemo(
    () => (answerFilter === "все" ? data.answers : data.answers.filter((a) => a.тип === answerFilter)),
    [data.answers, answerFilter],
  );

  const answerCounts = useMemo(() => {
    const c = { все: data.answers.length, ответил: 0, кликнул: 0, тишина: 0 };
    for (const a of data.answers) c[a.тип] += 1;
    return c;
  }, [data.answers]);

  return (
    <main className="relative flex min-h-[calc(100vh-3.5rem)] flex-col animate-fade-in-up">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(ellipse_at_top,_hsl(210_80%_50%_/_0.14),_transparent_55%)]"
      />

      <header className="relative z-10 border-b border-border/50 bg-background/70 px-4 py-4 backdrop-blur-xl sm:px-6">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-end gap-4">
          <div className="min-w-0 flex-1">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/35 bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
              <Crosshair className="h-3 w-3" />
              2ГИС · скоринг · рассылка
            </span>
            <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Лидген</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Машина холодного поиска клиентов: парсер собирает базу, скоринг отбирает, рассылка касается,
              здесь видно, кто ответил.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
            Обновить
          </Button>
        </div>
      </header>

      <div className="relative z-10 mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6">
        {error ? (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div>
              <div className="font-medium">Не удалось загрузить данные лидгена</div>
              <div className="text-muted-foreground">{error}</div>
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="grid h-64 place-items-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Tabs defaultValue="overview">
            <TabsList className="mb-4 flex w-full flex-wrap justify-start gap-1 sm:w-auto">
              <TabsTrigger value="overview">Обзор</TabsTrigger>
              <TabsTrigger value="leads">Лиды</TabsTrigger>
              <TabsTrigger value="broadcast">Рассылка</TabsTrigger>
              <TabsTrigger value="answers">
                Ответы{answerCounts.ответил ? ` · ${answerCounts.ответил}` : ""}
              </TabsTrigger>
              <TabsTrigger value="runs">Прогоны</TabsTrigger>
            </TabsList>

            {/* ── ОБЗОР ─────────────────────────────────────── */}
            <TabsContent value="overview" className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Tile label="На складе" value={fmtNum(F?.всего ?? 0)} sub="всего спарсено" />
                <Tile label="Ждут скоринга" value={fmtNum(F?.ждут_скоринга ?? 0)} sub="статус new" />
                <Tile label="Горячих" value={fmtNum(F?.горячих_70_плюс ?? 0)} sub="балл 70 и выше" />
                <Tile label="В воронке" value={fmtNum(F?.ушли_в_воронку ?? 0)} sub="создано карточек" />
                <Tile label="Отсеяно" value={fmtNum(F?.отсеяно ?? 0)} sub="нет контакта" />
                <Tile label="Средний балл" value={F?.средний_балл != null ? String(F.средний_балл) : "—"} sub="по всей базе" />
              </div>

              <Panel title="Воронка">
                {data.stages.length ? (
                  <div className="space-y-2">
                    {data.stages.map((s, i) => (
                      <BarRow
                        key={s.title}
                        label={s.title}
                        value={s.cnt}
                        max={maxStage}
                        color={RAMP[Math.min(i, RAMP.length - 1)]}
                      />
                    ))}
                  </div>
                ) : (
                  <Empty>В воронке пока пусто</Empty>
                )}
              </Panel>

              <Panel title="Что продаём">
                {data.segments.length ? (
                  <div className="space-y-2">
                    {data.segments.map((s) => (
                      <BarRow
                        key={s.услуга}
                        label={s.услуга}
                        value={s.лидов}
                        max={maxSegment}
                        color="#3987e5"
                        right={`${fmtNum(s.лидов)} · балл ${s.средний_балл ?? "—"}`}
                      />
                    ))}
                  </div>
                ) : (
                  <Empty>Скоринг ещё не проходил — запустите парсер</Empty>
                )}
              </Panel>

              <Panel title="Качество базы">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border/60 text-xs text-muted-foreground">
                        <th className="p-2 text-left font-medium">Город</th>
                        <th className="p-2 text-left font-medium">Всего</th>
                        <th className="p-2 text-left font-medium">С тел.</th>
                        <th className="p-2 text-left font-medium">WhatsApp</th>
                        <th className="p-2 text-left font-medium">Без сайта</th>
                        <th className="p-2 text-left font-medium">Без инсты</th>
                        <th className="p-2 text-left font-medium">Рейтинг &lt;4.5</th>
                        <th className="p-2 text-left font-medium">Отзывов &lt;50</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.quality.length ? (
                        data.quality.map((q) => (
                          <tr key={q.city ?? "—"} className="border-b border-border/40 last:border-0">
                            <td className="p-2">{q.city ?? "—"}</td>
                            <td className="p-2 tabular-nums">{fmtNum(q.всего)}</td>
                            <td className="p-2 tabular-nums">{fmtNum(q.с_телефоном)}</td>
                            <td className="p-2 tabular-nums">{fmtNum(q.с_whatsapp)}</td>
                            <td className="p-2 tabular-nums">{fmtNum(q.без_сайта)}</td>
                            <td className="p-2 tabular-nums">{fmtNum(q.без_инстаграма)}</td>
                            <td className="p-2 tabular-nums">{fmtNum(q.рейтинг_ниже_4_5)}</td>
                            <td className="p-2 tabular-nums">{fmtNum(q.отзывов_меньше_50)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr><td colSpan={8}><Empty>Склад пуст</Empty></td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </TabsContent>

            {/* ── ЛИДЫ ──────────────────────────────────────── */}
            <TabsContent value="leads">
              <Panel title="Очередь на касание — по убыванию балла">
                {data.queue.length ? (
                  <div className="space-y-2">
                    {data.queue.map((l, i) => {
                      const phone = l.phones?.[0] ?? l.whatsapp ?? null;
                      const link = waLink(phone);
                      return (
                        <div key={`${l.source_url ?? l.name}-${i}`} className="rounded-lg border border-border/50 bg-card/40 p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium">{l.name}</span>
                                <ScoreBadge score={l.ai_score} />
                                {l.ai_segment ? (
                                  <span className="rounded-full border border-border/60 bg-card/60 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                                    {l.ai_segment}
                                  </span>
                                ) : null}
                              </div>
                              {l.ai_pain ? (
                                <p className="mt-1 text-sm text-muted-foreground">{l.ai_pain}</p>
                              ) : null}
                            </div>
                            <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              {l.rating != null ? (
                                <span className="inline-flex items-center gap-1 tabular-nums">
                                  <Star className="h-3 w-3" />{l.rating} · {fmtNum(l.review_count ?? 0)}
                                </span>
                              ) : null}
                              {l.website ? (
                                <a href={l.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                                  <Globe className="h-3 w-3" />сайт
                                </a>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-amber-500">
                                  <Globe className="h-3 w-3" />нет сайта
                                </span>
                              )}
                              {l.instagram ? (
                                <a href={l.instagram} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                                  <Instagram className="h-3 w-3" />инста
                                </a>
                              ) : null}
                              {link ? (
                                <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                                  <Phone className="h-3 w-3" />{phone}
                                </a>
                              ) : null}
                              {l.source_url ? (
                                <a href={l.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                                  <ExternalLink className="h-3 w-3" />2ГИС
                                </a>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <Empty>Очередь пуста — запустите парсер и скоринг</Empty>
                )}
              </Panel>
            </TabsContent>

            {/* ── РАССЫЛКА ──────────────────────────────────── */}
            <TabsContent value="broadcast" className="space-y-4">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Tile label="Отправлено" value={fmtNum(AS?.отправлено ?? 0)} sub="всего касаний" />
                <Tile label="Кликнули" value={fmtNum(AS?.кликнули ?? 0)} sub={`${share(AS?.кликнули ?? 0, AS?.отправлено ?? 0)} от отправленных`} />
                <Tile label="Ответили" value={fmtNum(AS?.ответили ?? 0)} sub={`${share(AS?.ответили ?? 0, AS?.отправлено ?? 0)} от отправленных`} />
                <Tile label="Отписались" value={fmtNum(AS?.отписались ?? 0)} sub="в стоп-листе" />
              </div>

              <Panel title="Кампании">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border/60 text-xs text-muted-foreground">
                        <th className="p-2 text-left font-medium">Кампания</th>
                        <th className="p-2 text-left font-medium">Всего</th>
                        <th className="p-2 text-left font-medium">Отправлено</th>
                        <th className="p-2 text-left font-medium">Прочитано</th>
                        <th className="p-2 text-left font-medium">Клики</th>
                        <th className="p-2 text-left font-medium">Ответы</th>
                        <th className="p-2 text-left font-medium">Ошибки</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.campaigns.length ? (
                        data.campaigns.map((c) => (
                          <tr key={c.id} className="border-b border-border/40 last:border-0">
                            <td className="p-2">
                              <div className="font-medium">{c.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {c.channel} · {c.status} · вариантов: {c.variants}
                                {c.variants === 0 ? <span className="ml-1 text-amber-500">A/B не включён</span> : null}
                              </div>
                            </td>
                            <td className="p-2 tabular-nums">{fmtNum(c.всего)}</td>
                            <td className="p-2 tabular-nums">{fmtNum(c.отправлено)}</td>
                            <td className="p-2 tabular-nums">{fmtNum(c.прочитано)}</td>
                            <td className="p-2 tabular-nums">
                              {fmtNum(c.кликнули)}{" "}
                              <span className="text-xs text-muted-foreground">{share(c.кликнули, c.отправлено)}</span>
                            </td>
                            <td className="p-2 tabular-nums">
                              <b>{fmtNum(c.ответили)}</b>{" "}
                              <span className="text-xs text-muted-foreground">{share(c.ответили, c.отправлено)}</span>
                            </td>
                            <td className="p-2 tabular-nums">{fmtNum(c.ошибок)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr><td colSpan={7}><Empty>Кампаний нет</Empty></td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Panel>

              <Panel title="A/B по вариантам текста">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border/60 text-xs text-muted-foreground">
                        <th className="p-2 text-left font-medium">Кампания</th>
                        <th className="p-2 text-left font-medium">Вариант</th>
                        <th className="p-2 text-left font-medium">Отправлено</th>
                        <th className="p-2 text-left font-medium">Клики</th>
                        <th className="p-2 text-left font-medium">Ответы</th>
                        <th className="p-2 text-left font-medium">% ответов</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.variants.length ? (
                        data.variants.map((v, i) => (
                          <tr key={`${v.campaign}-${v.variant}-${i}`} className="border-b border-border/40 last:border-0">
                            <td className="p-2">{v.campaign}</td>
                            <td className="p-2">{v.variant}</td>
                            <td className="p-2 tabular-nums">{fmtNum(v.отправлено)}</td>
                            <td className="p-2 tabular-nums">{fmtNum(v.кликнули)}</td>
                            <td className="p-2 tabular-nums"><b>{fmtNum(v.ответили)}</b></td>
                            <td className="p-2 tabular-nums">{v.ответов_pct != null ? `${v.ответов_pct}%` : "—"}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6}>
                            <Empty>Вариантов нет — в кампании один текст, сравнивать не с чем</Empty>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </TabsContent>

            {/* ── ОТВЕТЫ ────────────────────────────────────── */}
            <TabsContent value="answers" className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {(["все", "ответил", "кликнул", "тишина"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setAnswerFilter(f)}
                    className={cn(
                      "rounded-full border px-3.5 py-1.5 text-xs transition-colors",
                      answerFilter === f
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border/60 bg-card/50 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {f === "все" ? "Все" : f === "ответил" ? "Ответили" : f === "кликнул" ? "Кликнули" : "Тишина"}
                    <span className="ml-1.5 tabular-nums opacity-70">{answerCounts[f]}</span>
                  </button>
                ))}
              </div>

              {answers.length ? (
                answers.map((a: LeadgenAnswer, i) => {
                  const link = waLink(a.phone);
                  return (
                    <div key={`${a.phone}-${a.кампания}-${i}`} className="rounded-xl border border-border/60 bg-card/40 p-4">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{a.имя ?? a.phone ?? "—"}</span>
                          <KindBadge kind={a.тип} />
                        </div>
                        <span className="text-xs text-muted-foreground">{shortDate(a.когда)}</span>
                      </div>

                      {a.последний_ответ ? (
                        <blockquote className="my-2.5 border-l-2 border-primary pl-3 text-sm">
                          {a.последний_ответ}
                        </blockquote>
                      ) : (
                        <p className="my-2 text-xs text-muted-foreground">
                          Текста ответа нет — только клик по ссылке
                        </p>
                      )}

                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        {link ? (
                          <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                            <MessageCircle className="h-3 w-3" />{a.phone}
                          </a>
                        ) : (
                          <span>{a.phone}</span>
                        )}
                        {a.кампания ? <span>· {a.кампания}</span> : null}
                        {a.variant ? <span>· вариант {a.variant}</span> : null}
                        {a.стадия ? <span>· {a.стадия}</span> : null}
                        {a.услуга ? <span>· {a.услуга}</span> : null}
                        <span>· <ScoreBadge score={a.ai_score} /></span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <Panel title="Ответы">
                  <Empty>
                    {data.answers.length
                      ? "В этом фильтре пусто"
                      : "Рассылок ещё не было — как уйдут первые касания, все ответы соберутся здесь"}
                  </Empty>
                </Panel>
              )}
            </TabsContent>

            {/* ── ПРОГОНЫ ───────────────────────────────────── */}
            <TabsContent value="runs">
              <Panel
                title="Прогоны парсера"
                action={
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Target className="h-3 w-3" />
                    источник: 2ГИС
                  </span>
                }
              >
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border/60 text-xs text-muted-foreground">
                        <th className="p-2 text-left font-medium">Когда</th>
                        <th className="p-2 text-left font-medium">Цель</th>
                        <th className="p-2 text-left font-medium">Статус</th>
                        <th className="p-2 text-left font-medium">Нашли</th>
                        <th className="p-2 text-left font-medium">Новых</th>
                        <th className="p-2 text-left font-medium">Дубли</th>
                        <th className="p-2 text-left font-medium">Время</th>
                        <th className="p-2 text-left font-medium">Ошибка</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.runs.length ? (
                        data.runs.map((r) => (
                          <tr key={r.id} className="border-b border-border/40 last:border-0">
                            <td className="p-2 whitespace-nowrap">{shortDate(r.started_at)}</td>
                            <td className="p-2">{r.query ?? "—"}</td>
                            <td className="p-2">
                              <span className={cn(r.status === "error" && "text-destructive")}>{r.status}</span>
                            </td>
                            <td className="p-2 tabular-nums">{fmtNum(r.found)}</td>
                            <td className="p-2 tabular-nums">{fmtNum(r.inserted)}</td>
                            <td className="p-2 tabular-nums">{fmtNum(r.duplicates)}</td>
                            <td className="p-2 tabular-nums">{r.seconds != null ? `${r.seconds} с` : "—"}</td>
                            <td className="p-2 text-xs text-muted-foreground">{r.error?.slice(0, 80) ?? ""}</td>
                          </tr>
                        ))
                      ) : (
                        <tr><td colSpan={8}><Empty>Парсер ещё не запускался</Empty></td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </TabsContent>
          </Tabs>
        )}

        {data.generated_at ? (
          <p className="mt-4 text-xs text-muted-foreground">
            Данные на {new Date(data.generated_at).toLocaleString("ru-RU")}
          </p>
        ) : null}
      </div>
    </main>
  );
};

export default Leadgen;
