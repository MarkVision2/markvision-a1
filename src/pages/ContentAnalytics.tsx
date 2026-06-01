import { lazy, Suspense, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Copy,
  ExternalLink,
  Eye,
  Film,
  Hash,
  Link2,
  Loader2,
  MessageCircle,
  MousePointerClick,
  Plus,
  ShoppingBag,
  Sparkles,
  Trash2,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { PeriodPicker, currentMonthRange } from "@/components/dashboard/PeriodPicker";
import type { ReportPeriodRange } from "@/hooks/useReportData";
import {
  useCodewordLeads,
  useCodewordStats,
  useInstagramCodewords,
  useInstagramOrganic,
  type CodewordStat,
  type InstagramOrganicEvent,
} from "@/hooks/useInstagramOrganic";
import { useInstagramAccounts, type InstagramAccount } from "@/hooks/useInstagramAccounts";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { cn } from "@/lib/utils";

const TrendChart = lazy(() => import("./content-analytics/ContentTrendChart"));

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
const REDIRECT_BASE = `${SUPABASE_URL}/functions/v1/ig-organic-redirect`;

const fmtMoney = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;
const fmtNum = (n: number) => Math.round(n).toLocaleString("ru-RU");
const fmtPct = (n: number) => `${n.toFixed(n >= 10 ? 0 : 1)}%`;

type SortKey = "codeword" | "codewordDms" | "linkClicks" | "leads" | "sales" | "revenue" | "lastEventAt";
type SortDir = "asc" | "desc";

interface KpiCardProps {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "default" | "success" | "warning";
}

const KpiCard = ({ icon: Icon, label, value, hint, tone = "default" }: KpiCardProps) => (
  <div
    className={cn(
      "rounded-2xl border border-border/60 bg-card/60 p-4 transition-colors",
      tone === "success" && "border-success/40 bg-success/5",
      tone === "warning" && "border-warning/40 bg-warning/5",
    )}
  >
    <div className="flex items-center gap-2">
      <span
        className={cn(
          "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
          tone === "success" ? "bg-success/15 text-success" : tone === "warning" ? "bg-warning/15 text-warning" : "bg-success/10 text-success",
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
    </div>
    <div className="mt-3 text-2xl font-bold tracking-tight">{value}</div>
    {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
  </div>
);

interface AddCodewordDialogProps {
  accounts: InstagramAccount[];
  defaultAccountId: string | null;
  onAdd: (input: {
    codeword: string;
    reelUrl: string | null;
    targetUrl: string | null;
    thumbnailUrl: string | null;
    caption: string | null;
    igAccountId: string | null;
  }) => Promise<void>;
}

const AddCodewordDialog = ({ accounts, defaultAccountId, onAdd }: AddCodewordDialogProps) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [codeword, setCodeword] = useState("");
  const [reelUrl, setReelUrl] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [accountId, setAccountId] = useState<string>(defaultAccountId ?? "none");

  const reset = () => {
    setCodeword(""); setReelUrl(""); setTargetUrl(""); setThumbnailUrl(""); setCaption("");
    setAccountId(defaultAccountId ?? "none");
  };

  const submit = async () => {
    const word = codeword.trim().toLowerCase();
    if (!word) {
      toast.error("Введите код-слово");
      return;
    }
    setBusy(true);
    try {
      await onAdd({
        codeword: word,
        reelUrl: reelUrl.trim() || null,
        targetUrl: targetUrl.trim() || null,
        thumbnailUrl: thumbnailUrl.trim() || null,
        caption: caption.trim() || null,
        igAccountId: accountId === "none" ? null : accountId,
      });
      toast.success(`Код-слово «${word}» добавлено`);
      reset();
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось добавить");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5"><Plus className="h-4 w-4" />Добавить код-слово</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новое код-слово</DialogTitle>
          <DialogDescription>
            Привяжите код-слово к Reels — мы выдадим короткую ссылку и начнём считать DM, переходы и лиды.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Код-слово *</Label>
            <Input value={codeword} onChange={(e) => setCodeword(e.target.value)} placeholder="smile" autoFocus />
            <p className="text-[11px] text-muted-foreground">Регистр не важен — приведём к нижнему.</p>
          </div>
          {accounts.length > 0 && (
            <div className="space-y-1.5">
              <Label>Instagram аккаунт</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger><SelectValue placeholder="Не привязан" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Не привязан (общий для проекта)</SelectItem>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>@{a.handle}{a.displayName ? ` · ${a.displayName}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">Привязка нужна, чтобы фильтровать аналитику по аккаунту.</p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Ссылка на Reel</Label>
            <Input value={reelUrl} onChange={(e) => setReelUrl(e.target.value)} placeholder="https://instagram.com/reel/..." />
          </div>
          <div className="space-y-1.5">
            <Label>Target URL (куда вести)</Label>
            <Input value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} placeholder="https://site.com/offer" />
            <p className="text-[11px] text-muted-foreground">К URL добавим utm_campaign=code-word и параметр cw — лид-интейк подхватит автоматически.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Превью Reels (URL картинки)</Label>
            <Input value={thumbnailUrl} onChange={(e) => setThumbnailUrl(e.target.value)} placeholder="https://..." />
          </div>
          <div className="space-y-1.5">
            <Label>Подпись / заметка</Label>
            <Input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Зимняя акция -20%" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Отмена</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const ChartFallback = () => (
  <div className="grid h-[260px] w-full place-items-center">
    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
  </div>
);

const SortHead = ({ label, k, current, dir, onSort, align = "right" }: {
  label: string;
  k: SortKey;
  current: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
}) => {
  const active = current === k;
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={cn("px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground", align === "right" ? "text-right" : "text-left")}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn("inline-flex items-center gap-1 transition hover:text-foreground", align === "right" && "flex-row-reverse", active && "text-foreground")}
      >
        <span>{label}</span>
        <Icon className={cn("h-3 w-3", active ? "opacity-100" : "opacity-40")} />
      </button>
    </th>
  );
};

const CodewordRow = ({ stat, onOpen, onToggleActive, onCopyLink, onRemove }: {
  stat: CodewordStat;
  onOpen: (s: CodewordStat) => void;
  onToggleActive: (s: CodewordStat, v: boolean) => void;
  onCopyLink: (s: CodewordStat) => void;
  onRemove: (s: CodewordStat) => void;
}) => {
  const cr = stat.codewordDms > 0 ? (stat.leads / stat.codewordDms) * 100 : 0;
  return (
    <tr className="border-b border-border/40 transition-colors hover:bg-muted/40">
      <td className="px-3 py-3">
        <button onClick={() => onOpen(stat)} className="flex items-center gap-3 text-left">
          {stat.thumbnailUrl ? (
            <img src={stat.thumbnailUrl} alt="" className="h-10 w-10 rounded-lg object-cover" loading="lazy" />
          ) : (
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-muted text-muted-foreground"><Film className="h-4 w-4" /></span>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold">#{stat.codeword}</span>
              {!stat.active && <Badge variant="outline" className="text-[10px]">пауза</Badge>}
            </div>
            {stat.reelUrl && (
              <a href={stat.reelUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                Reels <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </button>
      </td>
      <td className="px-3 py-3 text-right tabular-nums">{fmtNum(stat.codewordDms)}</td>
      <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{fmtNum(stat.uniqueUsers)}</td>
      <td className="px-3 py-3 text-right tabular-nums">{fmtNum(stat.linkClicks)}</td>
      <td className="px-3 py-3 text-right tabular-nums font-medium">{fmtNum(stat.leads)}</td>
      <td className="px-3 py-3 text-right tabular-nums">{fmtNum(stat.sales)}</td>
      <td className="px-3 py-3 text-right tabular-nums font-semibold">{fmtMoney(stat.revenue)}</td>
      <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{fmtPct(cr)}</td>
      <td className="px-3 py-3">
        <div className="flex items-center justify-end gap-1.5">
          <Button size="icon" variant="ghost" title="Скопировать короткую ссылку" onClick={() => onCopyLink(stat)} disabled={!stat.shortId}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Switch checked={stat.active} onCheckedChange={(v) => onToggleActive(stat, v)} aria-label="Активно" />
          <Button size="icon" variant="ghost" title="Удалить" onClick={() => onRemove(stat)}>
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      </td>
    </tr>
  );
};

interface LeadsDrawerProps {
  stat: CodewordStat | null;
  onClose: () => void;
}

const LeadsDrawer = ({ stat, onClose }: LeadsDrawerProps) => {
  const { leads, loading } = useCodewordLeads(stat?.codewordId ?? null);
  return (
    <Sheet open={!!stat} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-full max-w-md overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Hash className="h-4 w-4" />{stat?.codeword}
          </SheetTitle>
          <SheetDescription>
            DM → клики → лиды → продажи по этому код-слову.
          </SheetDescription>
        </SheetHeader>
        {stat && (
          <>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <MiniStat icon={MessageCircle} label="DM" value={fmtNum(stat.codewordDms)} />
              <MiniStat icon={MousePointerClick} label="Клики" value={fmtNum(stat.linkClicks)} />
              <MiniStat icon={Users} label="Лиды" value={fmtNum(stat.leads)} />
              <MiniStat icon={ShoppingBag} label="Продажи" value={fmtNum(stat.sales)} />
              <MiniStat icon={Wallet} label="Выручка" value={fmtMoney(stat.revenue)} />
              <MiniStat
                icon={TrendingUp}
                label="DM→Лид"
                value={fmtPct(stat.codewordDms > 0 ? (stat.leads / stat.codewordDms) * 100 : 0)}
              />
            </div>
            {stat.shortId && (
              <div className="mt-4 rounded-xl border border-border/60 bg-muted/40 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Короткая ссылка</div>
                <div className="mt-1.5 flex items-center gap-2">
                  <code className="flex-1 break-all rounded bg-background px-2 py-1 text-[11px]">{REDIRECT_BASE}?c={stat.shortId}</code>
                  <Button size="icon" variant="ghost" onClick={() => {
                    void navigator.clipboard.writeText(`${REDIRECT_BASE}?c=${stat.shortId}`);
                    toast.success("Ссылка скопирована");
                  }}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Эту ссылку отдаёт бот в DM в ответ на код-слово. Клик фиксируется автоматически.
                </p>
              </div>
            )}
            <div className="mt-5">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Лиды</div>
              {loading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
                </div>
              ) : leads.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
                  Пока ни одного лида с этого код-слова.
                </div>
              ) : (
                <ul className="space-y-2">
                  {leads.map((l) => (
                    <li key={l.leadId} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-card/60 p-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium">{l.name}</span>
                          {l.paid && <Badge className="bg-success/15 text-success">Оплачен</Badge>}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {l.phone}{l.source ? ` · ${l.source}` : ""}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold tabular-nums">{l.amount > 0 ? fmtMoney(l.amount) : "—"}</div>
                        <div className="text-[11px] text-muted-foreground">{new Date(l.createdAt).toLocaleDateString("ru-RU")}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};

const MiniStat = ({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: React.ReactNode }) => (
  <div className="rounded-xl border border-border/60 bg-card/60 p-3">
    <div className="flex items-center gap-1.5">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
    </div>
    <div className="mt-1 text-base font-bold tabular-nums">{value}</div>
  </div>
);

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function buildTrend(events: InstagramOrganicEvent[], range: ReportPeriodRange) {
  const map = new Map<string, { date: string; dms: number; clicks: number; leads: number }>();
  const cursor = new Date(range.from);
  cursor.setHours(0, 0, 0, 0);
  const stop = new Date(range.to);
  stop.setHours(23, 59, 59, 999);
  while (cursor <= stop) {
    const k = ymd(cursor);
    map.set(k, { date: k, dms: 0, clicks: 0, leads: 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  for (const e of events) {
    const bucket = map.get(e.date);
    if (!bucket) continue;
    if (e.eventType === "codeword_dm") bucket.dms += 1;
    else if (e.eventType === "link_click") bucket.clicks += 1;
    else if (e.eventType === "lead") bucket.leads += 1;
  }
  return Array.from(map.values());
}

const ContentAnalytics = () => {
  const [range, setRange] = useState<ReportPeriodRange>(() => currentMonthRange());
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [drawer, setDrawer] = useState<CodewordStat | null>(null);
  const [accountFilter, setAccountFilter] = useState<string>("all");

  const { activeId: projectId } = useProjectsStore();
  const { events, funnel: eventsFunnel, loading: eventsLoading } = useInstagramOrganic(range);
  const { stats: rawStats, loading: statsLoading } = useCodewordStats();
  const { items: accounts } = useInstagramAccounts();
  const { add, update, remove } = useInstagramCodewords();

  const stats = useMemo(() => {
    if (accountFilter === "all") return rawStats;
    if (accountFilter === "unbound") return rawStats.filter((s) => !s.igAccountId);
    return rawStats.filter((s) => s.igAccountId === accountFilter);
  }, [rawStats, accountFilter]);

  const filteredEvents = useMemo(() => {
    if (accountFilter === "all") return events;
    const allowed = new Set(stats.map((s) => s.codewordId));
    return events.filter((e) => (e.codewordId ? allowed.has(e.codewordId) : false));
  }, [events, stats, accountFilter]);

  const funnel = useMemo(() => {
    if (accountFilter === "all") return eventsFunnel;
    const dms = filteredEvents.filter((e) => e.eventType === "codeword_dm");
    const clicks = filteredEvents.filter((e) => e.eventType === "link_click");
    const leads = filteredEvents.filter((e) => e.eventType === "lead");
    const uniqueUsers = new Set(dms.map((e) => e.username || e.contact || e.id)).size;
    return { codewordDms: dms.length, uniqueUsers, linkClicks: clicks.length, leads: leads.length };
  }, [eventsFunnel, filteredEvents, accountFilter]);

  const totals = useMemo(() => {
    const sales = stats.reduce((s, x) => s + x.sales, 0);
    const revenue = stats.reduce((s, x) => s + x.revenue, 0);
    return {
      ...funnel,
      sales,
      revenue,
      dmToLead: funnel.codewordDms > 0 ? (funnel.leads / funnel.codewordDms) * 100 : 0,
      clickToLead: funnel.linkClicks > 0 ? (funnel.leads / funnel.linkClicks) * 100 : 0,
    };
  }, [funnel, stats]);

  const trend = useMemo(() => buildTrend(filteredEvents, range), [filteredEvents, range]);

  const sortedStats = useMemo(() => {
    const arr = [...stats];
    arr.sort((a, b) => {
      const sign = sortDir === "asc" ? 1 : -1;
      if (sortKey === "codeword") return sign * a.codeword.localeCompare(b.codeword);
      if (sortKey === "lastEventAt") {
        const av = a.lastEventAt ? new Date(a.lastEventAt).getTime() : 0;
        const bv = b.lastEventAt ? new Date(b.lastEventAt).getTime() : 0;
        return sign * (av - bv);
      }
      return sign * (a[sortKey] - b[sortKey]);
    });
    return arr;
  }, [stats, sortKey, sortDir]);

  const onSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("desc"); }
  };

  const handleAdd = async (input: { codeword: string; reelUrl: string | null; targetUrl: string | null; thumbnailUrl: string | null; caption: string | null; igAccountId: string | null }) => {
    await add({
      codeword: input.codeword,
      reelId: null,
      reelUrl: input.reelUrl,
      thumbnailUrl: input.thumbnailUrl,
      caption: input.caption,
      publishedAt: null,
      targetUrl: input.targetUrl,
      igAccountId: input.igAccountId ?? (accountFilter !== "all" && accountFilter !== "unbound" ? accountFilter : null),
      active: true,
    });
  };

  const handleToggleActive = async (stat: CodewordStat, active: boolean) => {
    try {
      await update(stat.codewordId, { active });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось обновить");
    }
  };

  const handleCopyLink = (stat: CodewordStat) => {
    if (!stat.shortId) return;
    void navigator.clipboard.writeText(`${REDIRECT_BASE}?c=${stat.shortId}`);
    toast.success("Короткая ссылка скопирована");
  };

  const handleRemove = async (stat: CodewordStat) => {
    if (!confirm(`Удалить код-слово «${stat.codeword}»? События в истории сохранятся.`)) return;
    try {
      await remove(stat.codewordId);
      toast.success("Удалено");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось удалить");
    }
  };

  return (
    <PageContainer wide>
      <PageHeader
        icon={Sparkles}
        title="Контент-аналитика"
        description="Сквозная воронка органического контента: код-слово под Reels → DM → клик по ссылке → лид в CRM → продажа."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {accounts.length > 0 && (
              <Select value={accountFilter} onValueChange={setAccountFilter}>
                <SelectTrigger className="h-9 w-[200px]"><SelectValue placeholder="Все аккаунты" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все аккаунты</SelectItem>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>@{a.handle}</SelectItem>
                  ))}
                  <SelectItem value="unbound">Без привязки</SelectItem>
                </SelectContent>
              </Select>
            )}
            <PeriodPicker range={range} onChange={setRange} />
            <AddCodewordDialog
              accounts={accounts}
              defaultAccountId={accountFilter !== "all" && accountFilter !== "unbound" ? accountFilter : null}
              onAdd={handleAdd}
            />
          </div>
        }
      />

      {!projectId ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border/60 p-10 text-center text-muted-foreground">
          Выберите проект в верхней панели — данные привязаны к проекту.
        </div>
      ) : (
        <>
          <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <KpiCard icon={MessageCircle} label="DM с код-словом" value={fmtNum(totals.codewordDms)} hint="за выбранный период" />
            <KpiCard icon={Users} label="Уникальных" value={fmtNum(totals.uniqueUsers)} hint="по username" />
            <KpiCard icon={MousePointerClick} label="Кликов по ссылке" value={fmtNum(totals.linkClicks)} />
            <KpiCard icon={Eye} label="Лидов" value={fmtNum(totals.leads)} tone="success" />
            <KpiCard icon={ShoppingBag} label="Продаж" value={fmtNum(totals.sales)} tone="success" hint="всего по код-словам" />
            <KpiCard icon={Wallet} label="Выручка" value={fmtMoney(totals.revenue)} tone="success" />
            <KpiCard icon={TrendingUp} label="DM → Лид" value={fmtPct(totals.dmToLead)} hint={`Клик → Лид ${fmtPct(totals.clickToLead)}`} tone="warning" />
          </section>

          <section className="mt-6 rounded-2xl border border-border/60 bg-card/60 p-5">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">Тренд по дням</div>
                <div className="text-[11px] text-muted-foreground">DM в директ, переходы по ссылке и лиды</div>
              </div>
            </div>
            <Suspense fallback={<ChartFallback />}>
              <TrendChart data={trend} />
            </Suspense>
          </section>

          <section className="mt-6 rounded-2xl border border-border/60 bg-card/60">
            <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
              <div>
                <div className="text-sm font-semibold">Код-слова</div>
                <div className="text-[11px] text-muted-foreground">{stats.length} активных и архивных</div>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Link2 className="h-3.5 w-3.5" />
                нажмите на строку — увидите лидов по код-слову
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr>
                    <SortHead label="Код-слово / Reel" k="codeword" current={sortKey} dir={sortDir} onSort={onSort} align="left" />
                    <SortHead label="DM" k="codewordDms" current={sortKey} dir={sortDir} onSort={onSort} />
                    <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Уникальных</th>
                    <SortHead label="Клики" k="linkClicks" current={sortKey} dir={sortDir} onSort={onSort} />
                    <SortHead label="Лиды" k="leads" current={sortKey} dir={sortDir} onSort={onSort} />
                    <SortHead label="Продажи" k="sales" current={sortKey} dir={sortDir} onSort={onSort} />
                    <SortHead label="Выручка" k="revenue" current={sortKey} dir={sortDir} onSort={onSort} />
                    <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">CR</th>
                    <th className="px-3 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {statsLoading || eventsLoading ? (
                    <tr><td colSpan={9} className="px-3 py-12 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></td></tr>
                  ) : sortedStats.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-3 py-12 text-center text-muted-foreground">
                        Пока нет ни одного код-слова. Добавьте первое — мы сразу выдадим короткую ссылку для бота.
                      </td>
                    </tr>
                  ) : sortedStats.map((s) => (
                    <CodewordRow
                      key={s.codewordId}
                      stat={s}
                      onOpen={setDrawer}
                      onToggleActive={handleToggleActive}
                      onCopyLink={handleCopyLink}
                      onRemove={handleRemove}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <LeadsDrawer stat={drawer} onClose={() => setDrawer(null)} />
        </>
      )}
    </PageContainer>
  );
};

export default ContentAnalytics;
