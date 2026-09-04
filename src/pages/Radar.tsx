/**
 * Радар идей: источники → посты конкурентов → разбор → банк идей → тема в
 * контент-плане. Данные — хук useRadar (edge-функция `radar`).
 */
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ChevronDown, ChevronUp, ExternalLink, Link2, Loader2, Plus, Radar as RadarIcon, RefreshCw, Sparkles, Trash2,
} from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRadar } from "@/hooks/useRadar";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import {
  ANALYSIS_STATUS_META,
  IDEA_STATUS_META,
  PLATFORM_META,
  SCORE_TONE_CLS,
  SOURCE_KIND_META,
  formatEngagement,
  scoreTone,
  sourceHandleFromUrl,
  type Idea,
  type IdeaStatus,
  type RadarGroup,
  type RadarPlatform,
  type RadarPost,
  type RadarSource,
  type RadarSourceKind,
} from "@/lib/radarClient";
import { cn } from "@/lib/utils";

/* ───────────────────────────── помощники ───────────────────────────── */

const PLATFORMS = Object.keys(PLATFORM_META) as RadarPlatform[];
const KINDS = Object.keys(SOURCE_KIND_META) as RadarSourceKind[];
const NO_GROUP = "__none__";

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", {
    timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function fmtCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

const fmtUsd = (n: number | null | undefined) => `$${(Number(n) || 0).toFixed(2)}`;

const errMsg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

function ScoreBadge({ score }: { score: number | null | undefined }) {
  const tone = scoreTone(score);
  return (
    <Badge variant="outline" className={cn("border-transparent tabular-nums", SCORE_TONE_CLS[tone])} title="Оценка потенциала">
      {score == null ? "—" : Math.round(Number(score))}
    </Badge>
  );
}

function Chip({ label, cls }: { label: string; cls: string }) {
  return <Badge variant="outline" className={cn("border-transparent font-medium", cls)}>{label}</Badge>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/* ───────────────────────────── плитки метрик ───────────────────────────── */

function MetricTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/* ───────────────────────────── диалоги ───────────────────────────── */

function AddSourceDialog({
  open, onOpenChange, busy, onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  busy: boolean;
  onSubmit: (input: {
    platform: RadarPlatform; kind: RadarSourceKind; handle: string; label: string | null; crawl_interval_hours: number;
  }) => Promise<void>;
}) {
  const [platform, setPlatform] = useState<RadarPlatform>("instagram");
  const [kind, setKind] = useState<RadarSourceKind>("competitor_account");
  const [handle, setHandle] = useState("");
  const [label, setLabel] = useState("");
  const [interval, setInterval] = useState("24");

  const submit = async () => {
    const h = sourceHandleFromUrl(handle);
    if (!h) {
      toast.error("Укажите ник или ссылку на аккаунт");
      return;
    }
    await onSubmit({
      platform, kind, handle: h, label: label.trim() || null,
      crawl_interval_hours: Math.min(Math.max(Number(interval) || 24, 1), 168),
    });
    setHandle("");
    setLabel("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Добавить источник</DialogTitle>
          <DialogDescription>Аккаунт конкурента, хештег или запрос в библиотеке рекламы — радар будет собирать посты по расписанию.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="radar-src-platform">Площадка</Label>
              <Select value={platform} onValueChange={(v) => setPlatform(v as RadarPlatform)}>
                <SelectTrigger id="radar-src-platform"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map((p) => <SelectItem key={p} value={p}>{PLATFORM_META[p].label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="radar-src-kind">Тип</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as RadarSourceKind)}>
                <SelectTrigger id="radar-src-kind"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => <SelectItem key={k} value={k}>{SOURCE_KIND_META[k].label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="radar-src-handle">Ник или ссылка</Label>
            <Input
              id="radar-src-handle"
              placeholder="@clinic или https://instagram.com/clinic"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              onBlur={() => setHandle((v) => sourceHandleFromUrl(v))}
            />
          </div>
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="radar-src-label">Подпись</Label>
              <Input id="radar-src-label" placeholder="Например, «Стоматология рядом»" value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="radar-src-interval">Интервал, ч</Label>
              <Input id="radar-src-interval" type="number" min={1} max={168} value={interval} onChange={(e) => setInterval(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Отмена</Button>
          <Button onClick={() => void submit()} disabled={busy} className="gap-1">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Добавить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AnalyzeUrlDialog({
  open, onOpenChange, busy, onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  busy: boolean;
  onSubmit: (url: string) => Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const submit = async () => {
    const u = url.trim();
    if (!u) {
      toast.error("Вставьте ссылку на публикацию");
      return;
    }
    await onSubmit(u);
    setUrl("");
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Разобрать ссылку</DialogTitle>
          <DialogDescription>Публикация Instagram / TikTok / YouTube / Threads / Facebook — скачаем, расшифруем и разберём на хук, структуру и идею.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="radar-url">Ссылка</Label>
          <Input id="radar-url" placeholder="https://www.instagram.com/reel/…" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Отмена</Button>
          <Button onClick={() => void submit()} disabled={busy} className="gap-1">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Разобрать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────────── идеи ───────────────────────────── */

function IdeaCard({
  idea, groups, busy, onPromote, onStatus,
}: {
  idea: Idea;
  groups: RadarGroup[];
  busy: boolean;
  onPromote: (groupId: string | null) => Promise<void>;
  onStatus: (status: Exclude<IdeaStatus, "used">) => Promise<void>;
}) {
  const [picking, setPicking] = useState(false);
  const [groupId, setGroupId] = useState<string>(idea.target_group_id ?? groups[0]?.id ?? NO_GROUP);
  const status = IDEA_STATUS_META[idea.status];

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4">
      <div className="flex items-start gap-3">
        <ScoreBadge score={idea.score} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold leading-snug">{idea.title}</div>
          {idea.hook && (
            <blockquote className="mt-1.5 border-l-2 border-border pl-3 text-sm italic text-muted-foreground">«{idea.hook}»</blockquote>
          )}
          {idea.angle && <p className="mt-2 text-sm">{idea.angle}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {idea.niche && <Chip label={idea.niche} cls="bg-muted text-muted-foreground" />}
            {idea.outcome_score != null && <Chip label={`результат ${Math.round(idea.outcome_score)}`} cls="bg-sky-500/10 text-sky-700" />}
            <Chip label={status.label} cls={status.cls} />
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {idea.status === "used" && idea.content_item_id ? (
          <Button asChild size="sm" variant="outline" className="gap-1">
            <Link to={`/marketing/content-plan/${idea.content_item_id}`}>
              <ExternalLink className="h-3.5 w-3.5" />
              Открыть тему в плане
            </Link>
          </Button>
        ) : picking ? (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger className="h-8 w-[220px]" aria-label="Группа аккаунтов"><SelectValue placeholder="Группа аккаунтов" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_GROUP}>Без группы</SelectItem>
                {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              disabled={busy}
              className="gap-1"
              onClick={() => void onPromote(groupId === NO_GROUP ? null : groupId).then(() => setPicking(false))}
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Подтвердить
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPicking(false)}>Отмена</Button>
          </div>
        ) : (
          <>
            <Button size="sm" disabled={busy || idea.status === "rejected"} onClick={() => setPicking(true)}>В контент-план</Button>
            {idea.status !== "approved" && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void onStatus("approved")}>Одобрить</Button>
            )}
            {idea.status !== "rejected" && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onStatus("rejected")}>Отклонить</Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────────── посты ───────────────────────────── */

function PostRow({
  post, busy, onAnalyze,
}: {
  post: RadarPost;
  busy: boolean;
  onAnalyze: () => void;
}) {
  const [open, setOpen] = useState(false);
  const m = post.metrics ?? {};
  const st = ANALYSIS_STATUS_META[post.analysis_status] ?? ANALYSIS_STATUS_META.pending;
  const a = post.analysis;
  const pm = PLATFORM_META[post.platform];

  return (
    <>
      <TableRow className="cursor-pointer" onClick={() => setOpen((v) => !v)} data-state={open ? "open" : undefined}>
        <TableCell className="w-[52px] pr-0">
          {post.thumbnail_url ? (
            <img src={post.thumbnail_url} alt="" className="h-10 w-10 rounded-md object-cover" loading="lazy" />
          ) : (
            <div className="h-10 w-10 rounded-md bg-muted" />
          )}
        </TableCell>
        <TableCell>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{post.author_handle ? `@${post.author_handle}` : "—"}</span>
            {pm && <Chip label={pm.label} cls={pm.cls} />}
          </div>
          {post.caption && <div className="mt-0.5 line-clamp-1 max-w-[360px] text-xs text-muted-foreground">{post.caption}</div>}
        </TableCell>
        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmtDate(post.published_at)}</TableCell>
        <TableCell className="whitespace-nowrap text-xs tabular-nums">
          <span title="Лайки">❤ {fmtCompact(m.likes ?? 0)}</span>
          <span className="mx-1.5 text-muted-foreground">·</span>
          <span title="Комментарии">💬 {fmtCompact(m.comments ?? 0)}</span>
          <span className="mx-1.5 text-muted-foreground">·</span>
          <span title="Репосты">↗ {fmtCompact(m.shares ?? 0)}</span>
          <span className="mx-1.5 text-muted-foreground">·</span>
          <span title="Сохранения">🔖 {fmtCompact(m.saves ?? 0)}</span>
          <span className="mx-1.5 text-muted-foreground">·</span>
          <span title="Просмотры">👁 {fmtCompact(m.views ?? 0)}</span>
        </TableCell>
        <TableCell className="whitespace-nowrap tabular-nums">{formatEngagement(post.engagement_rate)}</TableCell>
        <TableCell><ScoreBadge score={post.score} /></TableCell>
        <TableCell><Chip label={st.label} cls={st.cls} /></TableCell>
        <TableCell className="whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" className="gap-1" disabled={busy || post.analysis_status === "analyzing"} onClick={onAnalyze}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Разобрать
          </Button>
          {post.url && (
            <Button asChild size="sm" variant="ghost" className="gap-1">
              <a href={post.url} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />
                Открыть
              </a>
            </Button>
          )}
          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={open ? "Свернуть разбор" : "Показать разбор"} onClick={() => setOpen((v) => !v)}>
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </TableCell>
      </TableRow>
      {open && (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell colSpan={8}>
            {a ? (
              <div className="grid gap-3 text-sm md:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold uppercase text-muted-foreground">Хук</div>
                  <blockquote className="mt-1 border-l-2 border-border pl-3 italic">«{a.hook}»</blockquote>
                  <div className="mt-3 text-xs font-semibold uppercase text-muted-foreground">Почему работает</div>
                  <p className="mt-1">{a.why_it_works}</p>
                  {a.triggers?.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {a.triggers.map((t) => <Chip key={t} label={t} cls="bg-violet-500/10 text-violet-700" />)}
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase text-muted-foreground">Структура</div>
                  <dl className="mt-1 grid grid-cols-[90px_1fr] gap-x-3 gap-y-1">
                    <dt className="text-muted-foreground">Проблема</dt><dd>{a.structure?.problem || "—"}</dd>
                    <dt className="text-muted-foreground">Решение</dt><dd>{a.structure?.solution || "—"}</dd>
                    <dt className="text-muted-foreground">Призыв</dt><dd>{a.structure?.cta || "—"}</dd>
                  </dl>
                  {a.idea_title && (
                    <>
                      <div className="mt-3 text-xs font-semibold uppercase text-muted-foreground">Идея для нас</div>
                      <p className="mt-1 font-medium">{a.idea_title}</p>
                      {a.idea_angle && <p className="text-muted-foreground">{a.idea_angle}</p>}
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                {post.analysis_status === "failed" && post.error
                  ? `Разбор не удался: ${post.error}`
                  : "Пост ещё не разобран — нажмите «Разобрать» или дождитесь очереди."}
              </div>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/* ───────────────────────────── страница ───────────────────────────── */

export default function Radar() {
  const navigate = useNavigate();
  const { activeId: projectId } = useProjectsStore();
  const r = useRadar();
  const { sources, metrics, ideas, posts, groups, runs, loading, error, busy } = r;

  const [addOpen, setAddOpen] = useState(false);
  const [urlOpen, setUrlOpen] = useState(false);
  const [ideaFilter, setIdeaFilter] = useState<IdeaStatus | "all">("all");

  const visibleIdeas = useMemo(
    () => [...ideas].filter((i) => ideaFilter === "all" || i.status === ideaFilter).sort((a, b) => Number(b.score) - Number(a.score)),
    [ideas, ideaFilter],
  );

  const addSource = async (input: Parameters<React.ComponentProps<typeof AddSourceDialog>["onSubmit"]>[0]) => {
    try {
      const res = await r.upsertSource(input);
      toast.success(res.kicked ? "Источник добавлен, сбор запущен" : "Источник добавлен — сбор пойдёт по расписанию");
      setAddOpen(false);
    } catch (e) {
      toast.error(errMsg(e, "Не удалось добавить источник"));
    }
  };

  const analyzeUrl = async (url: string) => {
    try {
      const res = await r.analyzeUrl(url);
      toast.success(res.message || "Разбор запущен");
      setUrlOpen(false);
    } catch (e) {
      toast.error(errMsg(e, "Не удалось разобрать ссылку"));
    }
  };

  const toggleSource = async (s: RadarSource, enabled: boolean) => {
    try {
      await r.upsertSource({
        id: s.id, kind: s.kind, platform: s.platform, handle: s.handle, label: s.label,
        crawl_interval_hours: s.crawl_interval_hours, enabled, crawl_now: false,
      });
    } catch (e) {
      toast.error(errMsg(e, "Не удалось изменить источник"));
    }
  };

  const crawlSource = async (id: string) => {
    try {
      const res = await r.crawlSource(id);
      toast.success(res.kicked ? "Сбор запущен" : "Сборщик n8n недоступен — попробуйте позже");
    } catch (e) {
      toast.error(errMsg(e, "Не удалось запустить сбор"));
    }
  };

  const deleteSource = async (s: RadarSource) => {
    if (!window.confirm(`Удалить источник @${s.handle}? Собранные посты останутся.`)) return;
    try {
      await r.deleteSource(s.id);
      toast.success("Источник удалён");
    } catch (e) {
      toast.error(errMsg(e, "Не удалось удалить источник"));
    }
  };

  const analyzePost = async (id: string) => {
    try {
      const res = await r.analyzePost(id);
      toast.success(res.idea_id ? "Разобрано — идея добавлена в банк" : "Разобрано");
    } catch (e) {
      toast.error(errMsg(e, "Разбор не удался"));
    }
  };

  const promoteIdea = async (idea: Idea, groupId: string | null) => {
    try {
      const res = await r.promoteIdea(idea.id, groupId ? { group_id: groupId } : {});
      const to = `/marketing/content-plan/${res.item_id}`;
      toast.success("Тема создана в контент-плане", {
        description: idea.title,
        action: { label: "Открыть", onClick: () => navigate(to) },
      });
    } catch (e) {
      toast.error(errMsg(e, "Не удалось создать тему"));
    }
  };

  const setIdeaStatus = async (idea: Idea, status: Exclude<IdeaStatus, "used">) => {
    try {
      await r.updateIdea(idea.id, { status });
      toast.success(status === "approved" ? "Идея одобрена" : "Идея отклонена");
    } catch (e) {
      toast.error(errMsg(e, "Не удалось обновить идею"));
    }
  };

  if (!projectId) {
    return (
      <PageContainer>
        <PageHeader icon={RadarIcon} iconAccent="primary" title="Радар идей" />
        <div className="mt-6"><Empty>Выберите проект, чтобы видеть радар.</Empty></div>
      </PageContainer>
    );
  }

  return (
    <PageContainer wide>
      <PageHeader
        icon={RadarIcon}
        iconAccent="primary"
        title="Радар идей"
        description={
          <span className="inline-flex items-center gap-2">
            Посты конкурентов → разбор → идеи → темы контент-плана
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="gap-1" onClick={() => void r.refetch()} disabled={loading}>
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              Обновить
            </Button>
            <Button variant="outline" size="sm" className="gap-1" onClick={() => setUrlOpen(true)} disabled={busy != null}>
              <Link2 className="h-3.5 w-3.5" />
              Разобрать ссылку
            </Button>
            <Button size="sm" className="gap-1" onClick={() => setAddOpen(true)} disabled={busy != null}>
              <Plus className="h-3.5 w-3.5" />
              Добавить источник
            </Button>
          </div>
        }
      />

      {error && (
        <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MetricTile label="Источников" value={metrics?.sources ?? sources.length} />
        <MetricTile label="Постов за 7 дней" value={metrics?.posts_7d ?? 0} />
        <MetricTile label="Не разобрано" value={metrics?.posts_unanalyzed ?? 0} />
        <MetricTile label="Новых идей" value={metrics?.ideas_new ?? 0} />
        <MetricTile label="Использовано идей" value={metrics?.ideas_used ?? 0} />
        <MetricTile label="Расход за месяц" value={fmtUsd(metrics?.spent_month_usd)} />
      </div>

      <Tabs defaultValue="ideas" className="mt-6">
        <TabsList>
          <TabsTrigger value="ideas">Идеи{ideas.length ? ` (${ideas.length})` : ""}</TabsTrigger>
          <TabsTrigger value="posts">Посты{posts.length ? ` (${posts.length})` : ""}</TabsTrigger>
          <TabsTrigger value="sources">Источники{sources.length ? ` (${sources.length})` : ""}</TabsTrigger>
          <TabsTrigger value="runs">Сборы</TabsTrigger>
        </TabsList>

        {/* Идеи */}
        <TabsContent value="ideas" className="mt-4">
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {(["all", "new", "approved", "used", "rejected"] as const).map((s) => (
              <Button
                key={s}
                size="sm"
                variant={ideaFilter === s ? "default" : "outline"}
                onClick={() => setIdeaFilter(s)}
              >
                {s === "all" ? "Все" : IDEA_STATUS_META[s].label}
              </Button>
            ))}
          </div>
          {visibleIdeas.length === 0 ? (
            <Empty>Идей пока нет — добавьте источники или разберите ссылку, и разбор постов положит идеи сюда.</Empty>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {visibleIdeas.map((idea) => (
                <IdeaCard
                  key={idea.id}
                  idea={idea}
                  groups={groups}
                  busy={busy === `promote:${idea.id}` || busy === `idea:${idea.id}`}
                  onPromote={(gid) => promoteIdea(idea, gid)}
                  onStatus={(st) => setIdeaStatus(idea, st)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Посты */}
        <TabsContent value="posts" className="mt-4">
          {posts.length === 0 ? (
            <Empty>Постов ещё нет — после первого сбора здесь появится лента конкурентов с оценками.</Empty>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-border/60">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[52px]" />
                    <TableHead>Автор</TableHead>
                    <TableHead>Опубликован</TableHead>
                    <TableHead>Метрики</TableHead>
                    <TableHead>ER</TableHead>
                    <TableHead>Оценка</TableHead>
                    <TableHead>Разбор</TableHead>
                    <TableHead className="text-right">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {posts.map((p) => (
                    <PostRow key={p.id} post={p} busy={busy === `analyze:${p.id}`} onAnalyze={() => void analyzePost(p.id)} />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* Источники */}
        <TabsContent value="sources" className="mt-4">
          {sources.length === 0 ? (
            <Empty>Источников нет — добавьте аккаунт конкурента или хештег, чтобы радар начал собирать посты.</Empty>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-border/60">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Площадка</TableHead>
                    <TableHead>Тип</TableHead>
                    <TableHead>Ник</TableHead>
                    <TableHead>Подпись</TableHead>
                    <TableHead>Интервал</TableHead>
                    <TableHead>Последний сбор</TableHead>
                    <TableHead>Ошибка</TableHead>
                    <TableHead>Вкл.</TableHead>
                    <TableHead className="text-right">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sources.map((s) => {
                    const rowBusy = busy === "source" || busy === `crawl:${s.id}` || busy === `delete:${s.id}`;
                    return (
                      <TableRow key={s.id} className={cn(!s.enabled && "opacity-60")}>
                        <TableCell><Chip label={PLATFORM_META[s.platform]?.label ?? s.platform} cls={PLATFORM_META[s.platform]?.cls ?? ""} /></TableCell>
                        <TableCell><Chip label={SOURCE_KIND_META[s.kind]?.label ?? s.kind} cls={SOURCE_KIND_META[s.kind]?.cls ?? ""} /></TableCell>
                        <TableCell className="font-medium">@{s.handle}</TableCell>
                        <TableCell className="text-muted-foreground">{s.label || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums">{s.crawl_interval_hours} ч</TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmtDate(s.last_crawled_at)}</TableCell>
                        <TableCell className="max-w-[220px] truncate text-xs text-destructive" title={s.last_error ?? undefined}>{s.last_error || ""}</TableCell>
                        <TableCell>
                          <Switch
                            checked={s.enabled}
                            disabled={rowBusy}
                            aria-label={`Источник @${s.handle} включён`}
                            onCheckedChange={(v) => void toggleSource(s, v)}
                          />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right">
                          <Button size="sm" variant="ghost" className="gap-1" disabled={rowBusy} onClick={() => void crawlSource(s.id)}>
                            {busy === `crawl:${s.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                            Собрать сейчас
                          </Button>
                          <Button size="sm" variant="ghost" className="gap-1 text-destructive" disabled={rowBusy} onClick={() => void deleteSource(s)}>
                            <Trash2 className="h-3.5 w-3.5" />
                            Удалить
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* Сборы */}
        <TabsContent value="runs" className="mt-4">
          {runs.length === 0 ? (
            <Empty>Сборов ещё не было — они появятся после первого запуска сборщика.</Empty>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-border/60">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Провайдер</TableHead>
                    <TableHead>Элементов</TableHead>
                    <TableHead>Новых</TableHead>
                    <TableHead>Стоимость</TableHead>
                    <TableHead>Ошибка</TableHead>
                    <TableHead>Начало</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell className="font-medium">{run.provider}</TableCell>
                      <TableCell className="tabular-nums">{run.items}</TableCell>
                      <TableCell className="tabular-nums">{run.inserted}</TableCell>
                      <TableCell className="tabular-nums">{fmtUsd(run.cost_usd)}</TableCell>
                      <TableCell className="max-w-[280px] truncate text-xs text-destructive" title={run.error ?? undefined}>{run.error || ""}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmtDate(run.started_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <AddSourceDialog open={addOpen} onOpenChange={setAddOpen} busy={busy === "source"} onSubmit={addSource} />
      <AnalyzeUrlDialog open={urlOpen} onOpenChange={setUrlOpen} busy={busy === "analyze-url"} onSubmit={analyzeUrl} />
    </PageContainer>
  );
}
