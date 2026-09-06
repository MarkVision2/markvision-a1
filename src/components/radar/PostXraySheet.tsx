/**
 * Радар идей: «рентген» поста — боковая панель с динамикой (обычно / этот пост),
 * реакциями, разбором (почему залетел, хук, структура, триггеры), транскриптом
 * и сценарием для нас с кнопкой «В контент-план».
 */
import { useEffect, useState } from "react";
import { ExternalLink, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  ANALYSIS_STATUS_META, formatEngagement, IDEA_STATUS_META, radarApi, type Idea, type RadarGroup, type RadarPost,
} from "@/lib/radarClient";
import { formatAge, formatCompact, mediaTypeLabel, primaryMetric, usualMetric, VIRAL_X_FACTOR } from "@/lib/radarStats";
import { cn } from "@/lib/utils";
import { PostVideo } from "./PostVideo";
import { Chip, errMsg, PlatformChip, PostThumb, ScoreBadge, SectionLabel, XBadge } from "./RadarBits";

type PostIdea = Pick<Idea, "id" | "title" | "status" | "content_item_id" | "score">;
const NO_GROUP = "__none__";

interface PostXraySheetProps {
  post: RadarPost | null;
  groups: RadarGroup[];
  busy: string | null;
  onClose: () => void;
  onAnalyze: (post: RadarPost) => Promise<void>;
  onPromote: (ideaId: string, groupId: string | null) => Promise<void>;
  /** Версия данных: растёт после каждого refetch, чтобы панель перечитала пост. */
  version: number;
}

export function PostXraySheet({ post, groups, busy, onClose, onAnalyze, onPromote, version }: PostXraySheetProps) {
  const [full, setFull] = useState<(RadarPost & { transcript?: string | null }) | null>(null);
  const [ideas, setIdeas] = useState<PostIdea[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string>(groups[0]?.id ?? NO_GROUP);
  const [showTranscript, setShowTranscript] = useState(false);

  const id = post?.id ?? null;
  useEffect(() => {
    if (!id) {
      setFull(null);
      setIdeas([]);
      return;
    }
    let alive = true;
    setLoading(true);
    radarApi.post(id)
      .then((r) => {
        if (!alive) return;
        setFull(r.post);
        setIdeas(r.ideas);
        setError(null);
      })
      .catch((e) => alive && setError(errMsg(e, "Не удалось загрузить пост")))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id, version]);

  const p = full ?? post;
  if (!p) return <Sheet open={false} />;
  const a = p.analysis;
  const main = primaryMetric(p);
  const usual = usualMetric(p);
  const m = p.metrics ?? {};
  const st = ANALYSIS_STATUS_META[p.analysis_status] ?? ANALYSIS_STATUS_META.pending;
  const viral = Number(p.x_factor) >= VIRAL_X_FACTOR;
  const idea = ideas[0] ?? null;
  const analyzeBusy = busy === `analyze:${p.id}`;
  const promoteBusy = idea ? busy === `promote:${idea.id}` : false;

  return (
    <Sheet open={Boolean(post)} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="pr-10 text-left">
          <div className="flex items-center gap-2">
            <SectionLabel>Рентген</SectionLabel>
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            <XBadge x={p.x_factor} size="lg" className="ml-auto" />
          </div>
          <SheetTitle className="flex flex-wrap items-center gap-2 text-lg">
            <span className="min-w-0 max-w-full truncate" title={p.author_handle ? `@${p.author_handle}` : undefined}>
              {p.author_handle ? `@${p.author_handle}` : "Публикация"}
            </span>
            <PlatformChip platform={p.platform} />
            {a?.niche && <Chip label={a.niche} cls="bg-muted text-muted-foreground" />}
            <Chip label={st.label} cls={st.cls} />
          </SheetTitle>
          <SheetDescription>
            {formatAge(p.published_at)} · {mediaTypeLabel(p.media_type)} · подписчиков у автора {p.followers ? formatCompact(p.followers) : "—"}
          </SheetDescription>
        </SheetHeader>

        {error && <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div>}

        <div className="mt-4 grid grid-cols-[132px_1fr] gap-3 sm:grid-cols-[160px_1fr] sm:gap-4">
          <div className="relative aspect-[4/5] self-start overflow-hidden rounded-xl bg-muted">
            <PostVideo post={p} poster={<PostThumb post={p} compact className="absolute inset-0" />} />
          </div>
          <div className="grid min-w-0 gap-3">
            <div>
              <SectionLabel>Динамика</SectionLabel>
              <div className="mt-1.5 grid grid-cols-2 gap-2 sm:gap-3">
                <div className="min-w-0 rounded-xl border border-border/60 px-2.5 py-2 sm:px-3">
                  <div className="truncate text-xs text-muted-foreground">обычно у автора</div>
                  <div className="text-xl font-semibold tabular-nums">{usual == null ? "—" : formatCompact(usual)}</div>
                </div>
                <div className={cn("min-w-0 rounded-xl border px-2.5 py-2 sm:px-3", viral ? "border-success/40 bg-success/5" : "border-border/60")}>
                  <div className="truncate text-xs text-muted-foreground">этот пост</div>
                  <div className={cn("text-xl font-semibold tabular-nums", viral && "text-success")}>{formatCompact(main.value)}</div>
                </div>
              </div>
              {p.norm_views != null && main.kind === "views" && (
                <div className="mt-1 text-xs text-muted-foreground">норма для аудитории автора — {formatCompact(p.norm_views)} просмотров</div>
              )}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">
              <span title="Лайки">❤ {formatCompact(m.likes ?? 0)}</span>
              <span title="Комментарии">💬 {formatCompact(m.comments ?? 0)}</span>
              <span title="Репосты">↗ {formatCompact(m.shares ?? 0)}</span>
              <span title="Сохранения">🔖 {formatCompact(m.saves ?? 0)}</span>
              <span title="Просмотры">👁 {formatCompact(m.views ?? 0)}</span>
              <span title="Engagement rate">ER {formatEngagement(p.engagement_rate)}</span>
              <span className="inline-flex items-center gap-1">оценка <ScoreBadge score={p.score} /></span>
            </div>
            {p.caption && <p className="whitespace-pre-line text-sm text-muted-foreground line-clamp-6">{p.caption}</p>}
          </div>
        </div>

        {a ? (
          <div className="mt-5 grid gap-5">
            <section>
              <SectionLabel>Почему залетел</SectionLabel>
              <p className="mt-1.5 text-sm leading-relaxed">{a.why_it_works || "—"}</p>
              {a.triggers?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {a.triggers.map((t) => <Chip key={t} label={t} cls="bg-violet-500/15 text-violet-300 ring-1 ring-inset ring-violet-500/30" />)}
                </div>
              )}
            </section>
            <section>
              <SectionLabel>Хук · первые 2 секунды</SectionLabel>
              <blockquote className="mt-1.5 rounded-xl border-l-4 border-success bg-success/5 px-3 py-2 text-base font-medium">«{a.hook}»</blockquote>
            </section>
            <section>
              <SectionLabel>Структура</SectionLabel>
              <dl className="mt-1.5 grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 text-sm sm:grid-cols-[100px_1fr]">
                <dt className="text-muted-foreground">Проблема</dt><dd>{a.structure?.problem || "—"}</dd>
                <dt className="text-muted-foreground">Решение</dt><dd>{a.structure?.solution || "—"}</dd>
                <dt className="text-muted-foreground">Призыв</dt><dd>{a.structure?.cta || "—"}</dd>
              </dl>
            </section>
            {full?.transcript && (
              <section>
                <button type="button" className="text-left" onClick={() => setShowTranscript((v) => !v)}>
                  <SectionLabel>Что говорят в видео {showTranscript ? "▾" : "▸"}</SectionLabel>
                </button>
                {showTranscript && <p className="mt-1.5 whitespace-pre-line rounded-xl bg-muted/50 p-3 text-sm leading-relaxed">{full.transcript}</p>}
              </section>
            )}
            <section className="rounded-2xl border border-success/30 bg-success/5 p-4">
              <SectionLabel className="text-success">Ваш сценарий</SectionLabel>
              <div className="mt-1.5 text-base font-semibold">{a.idea_title}</div>
              {a.idea_angle && <p className="mt-1 text-sm text-muted-foreground">{a.idea_angle}</p>}
              {a.script_outline && <p className="mt-3 whitespace-pre-line text-sm leading-relaxed">{a.script_outline}</p>}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {idea ? (
                  idea.status === "used" && idea.content_item_id ? (
                    <Button asChild size="sm" variant="outline" className="gap-1">
                      <a href={`/marketing/content-plan/${idea.content_item_id}`}><ExternalLink className="h-3.5 w-3.5" />Открыть тему в плане</a>
                    </Button>
                  ) : (
                    <>
                      <Select value={groupId} onValueChange={setGroupId}>
                        <SelectTrigger className="h-8 w-[200px]" aria-label="Группа аккаунтов"><SelectValue placeholder="Группа аккаунтов" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_GROUP}>Без группы</SelectItem>
                          {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Button size="sm" className="gap-1" disabled={promoteBusy} onClick={() => void onPromote(idea.id, groupId === NO_GROUP ? null : groupId)}>
                        {promoteBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        В контент-план
                      </Button>
                      <Chip label={IDEA_STATUS_META[idea.status].label} cls={IDEA_STATUS_META[idea.status].cls} />
                    </>
                  )
                ) : (
                  <span className="text-xs text-muted-foreground">Оценка ниже порога 55 — идея не попала в банк. Можно разобрать заново.</span>
                )}
              </div>
            </section>
          </div>
        ) : (
          <div className="mt-5 rounded-2xl border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
            {p.analysis_status === "failed" && p.error
              ? <>Разбор не удался: {p.error}</>
              : p.analysis_status === "analyzing"
                ? "Разбираем: модель читает подпись и речь — обычно до минуты."
                : "Пост ещё не разобран — нажмите «Разобрать», и через минуту здесь появятся хук, структура и сценарий."}
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
          <Button size="sm" variant={a ? "outline" : "default"} className="gap-1" disabled={analyzeBusy || p.analysis_status === "analyzing"} onClick={() => void onAnalyze(p)}>
            {analyzeBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : a ? <RefreshCw className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
            {a ? "Разобрать заново" : "Разобрать"}
          </Button>
          {p.url && (
            <Button asChild size="sm" variant="ghost" className="gap-1">
              <a href={p.url} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" />Открыть оригинал</a>
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
