import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertCircle, ExternalLink, KeyRound, Loader2, PauseCircle, Plus, RefreshCw, Send, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { usePublishing, type UsePublishing } from "@/hooks/usePublishing";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import {
  ACCOUNT_STATUS_META,
  ENGINE_META,
  JOB_STATUS_META,
  NOTIFY_MODE_META,
  PLATFORM_META,
  PUBLISH_MODE_META,
  REVIEW_MODE_META,
  STRATEGY_META,
  effectiveDailyLimit,
  healthTone,
  rampStage,
  readOAuthResult,
  startPublishOAuth,
  type AvailablePage,
  type GroupMetrics,
  type OAuthPlatform,
  type NotifyMode,
  type Persona,
  type PersonaEngine,
  type PublishAccount,
  type PublishGroup,
  type PublishJobStatus,
  type PublishMode,
  type PublishPlatform,
  type PublishStrategy,
  type ReviewMode,
} from "@/lib/publishingClient";
import { cn } from "@/lib/utils";

/* ───────────────────────────── утилиты ───────────────────────────── */

const NONE = "__none"; // Radix Select не принимает пустое значение — сентинел для «не выбрано».

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", { timeZone: "Asia/Almaty" });
}

function errMsg(e: unknown, fallback = "Ошибка"): string {
  return e instanceof Error ? e.message : fallback;
}

function splitCsv(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

function numOrUndef(s: string): number | undefined {
  const n = Number(s);
  return s.trim() === "" || Number.isNaN(n) ? undefined : n;
}

const HEALTH_CLS = {
  good: "[&>div]:bg-emerald-500",
  warn: "[&>div]:bg-amber-500",
  bad: "[&>div]:bg-destructive",
} as const;

/** TikTok, подключённый до появления права video.list, метрик не отдаёт — нужен reconnect. */
function metricsScopeHint(a: Pick<PublishAccount, "platform" | "oauth_scope">): string | null {
  if (a.platform !== "tiktok" || !a.oauth_scope) return null;
  return a.oauth_scope.split(/[,\s]+/).includes("video.list") ? null : "без права video.list — метрики не собираются, переподключите аккаунт";
}

function rampLabel(a: Pick<PublishAccount, "ramp_enabled" | "ramp_started_at">): string {
  const st = rampStage(a.ramp_enabled, a.ramp_started_at);
  if (st.stage === 4) return a.ramp_enabled ? "Полный лимит" : "Без разгона";
  return `Ступень ${st.stage} · ${st.limit}/день · ещё ${st.daysLeft} дн.`;
}

/** Валидация ссылки на видео — зеркало проверки в publish-accounts. */
export function validateFileUrl(url: string): string | null {
  const u = url.trim();
  if (!u) return "Укажите ссылку на видео";
  if (!/^https:\/\/.+\.(mp4|mov|m4v)(\?|$)/i.test(u)) return "Нужна https-ссылка на файл .mp4 или .mov";
  return null;
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">{text}</div>;
}

function Chip({ label, cls }: { label: string; cls: string }) {
  return <Badge variant="outline" className={cn("border-transparent font-medium", cls)}>{label}</Badge>;
}

/* ───────────────────────────── страница ───────────────────────────── */

const OAUTH_LABELS: Record<OAuthPlatform, string> = { threads: "Threads", tiktok: "TikTok", youtube: "YouTube" };

export default function Publishing() {
  const { activeId: projectId } = useProjectsStore();
  const pub = usePublishing();
  const disabled = pub.busy != null;
  const [dialog, setDialog] = useState<"instagram" | "threads" | "video" | null>(null);
  const [oauthBusy, setOauthBusy] = useState<OAuthPlatform | null>(null);
  const [params, setParams] = useSearchParams();

  // Возврат с OAuth площадки: ?publish_connected=… / ?publish_error=… → тост и обновление.
  useEffect(() => {
    const result = readOAuthResult(params.toString() ? `?${params.toString()}` : "");
    if (!result) return;
    if (result.connected) {
      toast.success(`Подключён ${OAUTH_LABELS[result.connected.platform as OAuthPlatform] ?? result.connected.platform}${result.connected.account ? `: ${result.connected.account}` : ""}`);
      void pub.refetch();
    } else if (result.error) {
      toast.error(`Подключение не удалось: ${result.error}`);
    }
    setParams((p) => { p.delete("publish_connected"); p.delete("publish_error"); p.delete("account"); return p; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const connectOAuth = async (platform: OAuthPlatform) => {
    if (!projectId) return;
    setOauthBusy(platform);
    try {
      const url = await startPublishOAuth(projectId, platform);
      window.location.assign(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось начать подключение");
      setOauthBusy(null);
    }
  };

  return (
    <PageContainer wide>
      <div className="space-y-6">
        <PageHeader
          icon={Send}
          iconAccent="pink"
          title="Публикации"
          description="Сеть аккаунтов площадок, группы, персоны и очередь автопубликации."
          actions={
            <>
              <Button variant="outline" size="sm" onClick={() => void pub.refetch()} disabled={disabled || pub.loading}>
                <RefreshCw className={cn("mr-1.5 h-4 w-4", pub.loading && "animate-spin")} /> Обновить
              </Button>
              <Button variant="outline" size="sm" onClick={() => setDialog("instagram")} disabled={disabled || !projectId}>
                <Plus className="mr-1.5 h-4 w-4" /> Подключить Instagram
              </Button>
              {(["threads", "tiktok", "youtube"] as OAuthPlatform[]).map((pl) => (
                <Button key={pl} variant="outline" size="sm" onClick={() => void connectOAuth(pl)} disabled={disabled || !projectId || oauthBusy != null}>
                  {oauthBusy === pl ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />} Подключить {OAUTH_LABELS[pl]}
                </Button>
              ))}
              <Button variant="ghost" size="sm" onClick={() => setDialog("threads")} disabled={disabled || !projectId} title="Threads по готовому токену">
                <KeyRound className="mr-1.5 h-4 w-4" /> Threads токеном
              </Button>
              <Button size="sm" onClick={() => setDialog("video")} disabled={disabled || !projectId}>
                <Upload className="mr-1.5 h-4 w-4" /> Залить видео
              </Button>
            </>
          }
        />

        {!projectId && <EmptyState text="Выберите проект, чтобы управлять публикациями." />}

        {pub.error && (
          <div className="flex items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{pub.error}</span>
          </div>
        )}

        {(pub.metrics?.publish?.paused || pub.settings?.settings.paused) && (
          <div className="flex items-start gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-800">
            <PauseCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Публикации проекта приостановлены: воркер не берёт задания, новые слоты не планируются. Снять паузу — во вкладке «Настройки».</span>
          </div>
        )}

        <SummaryTiles pub={pub} />

        <Tabs defaultValue="accounts">
          <TabsList className="flex-wrap">
            <TabsTrigger value="accounts">Аккаунты</TabsTrigger>
            <TabsTrigger value="network">Сеть</TabsTrigger>
            <TabsTrigger value="groups">Группы</TabsTrigger>
            <TabsTrigger value="personas">Персоны</TabsTrigger>
            <TabsTrigger value="jobs">Задания</TabsTrigger>
            <TabsTrigger value="settings">Настройки</TabsTrigger>
          </TabsList>
          <TabsContent value="accounts" className="mt-4"><AccountsTab pub={pub} /></TabsContent>
          <TabsContent value="network" className="mt-4"><NetworkTab pub={pub} /></TabsContent>
          <TabsContent value="groups" className="mt-4"><GroupsTab pub={pub} /></TabsContent>
          <TabsContent value="personas" className="mt-4"><PersonasTab pub={pub} /></TabsContent>
          <TabsContent value="jobs" className="mt-4"><JobsTab pub={pub} /></TabsContent>
          <TabsContent value="settings" className="mt-4"><SettingsTab pub={pub} /></TabsContent>
        </Tabs>
      </div>

      <ConnectInstagramDialog open={dialog === "instagram"} onClose={() => setDialog(null)} pub={pub} />
      <ConnectThreadsDialog open={dialog === "threads"} onClose={() => setDialog(null)} pub={pub} />
      <PublishVideoDialog open={dialog === "video"} onClose={() => setDialog(null)} pub={pub} />
    </PageContainer>
  );
}

/* ───────────────────────────── сводка ───────────────────────────── */

function SummaryTiles({ pub }: { pub: UsePublishing }) {
  const m = pub.metrics?.publish;
  const spend = m?.spent_month_usd ?? pub.settings?.spend.month_usd ?? null;
  const tiles: { label: string; value: string; hint?: string }[] = [
    { label: "Активных аккаунтов", value: m ? `${m.accounts_active} / ${m.accounts_total}` : "—" },
    { label: "В очереди", value: m ? String(m.jobs_queued) : "—", hint: m?.jobs_processing ? `публикуется: ${m.jobs_processing}` : undefined },
    { label: "Опубликовано за 24 ч", value: m ? String(m.published_24h) : "—" },
    { label: "Ошибок за 24 ч", value: m ? String(m.failed_24h) : "—", hint: m?.manual_review ? `на ручной проверке: ${m.manual_review}` : undefined },
    { label: "Среднее здоровье", value: m?.health_avg != null ? `${Math.round(m.health_avg)}%` : "—" },
    { label: "Токены истекают (7 дней)", value: m ? String(m.tokens_expiring_7d) : "—" },
    { label: "Расход за месяц", value: spend != null ? `$${spend.toFixed(2)}` : "—" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-2xl border bg-card p-4">
          <div className="text-xs text-muted-foreground">{t.label}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{t.value}</div>
          {t.hint && <div className="mt-0.5 text-xs text-muted-foreground">{t.hint}</div>}
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────────── аккаунты ───────────────────────────── */

function AccountsTab({ pub }: { pub: UsePublishing }) {
  const disabled = pub.busy != null;
  const run = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      toast.success(label);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  if (!pub.accounts.length) {
    return <EmptyState text="Аккаунтов пока нет — подключите Instagram-страницы через Meta или аккаунт Threads." />;
  }

  return (
    <div className="overflow-x-auto rounded-2xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Аккаунт</TableHead>
            <TableHead>Статус</TableHead>
            <TableHead>Группа</TableHead>
            <TableHead>Персона</TableHead>
            <TableHead>Лимит/день</TableHead>
            <TableHead>Разгон</TableHead>
            <TableHead>Здоровье</TableHead>
            <TableHead>Сегодня</TableHead>
            <TableHead>Последний пост</TableHead>
            <TableHead>Вкл</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {pub.accounts.map((a) => (
            <AccountRow key={a.id} a={a} pub={pub} disabled={disabled} run={run} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function AccountRow({
  a, pub, disabled, run,
}: { a: PublishAccount; pub: UsePublishing; disabled: boolean; run: (label: string, fn: () => Promise<unknown>) => Promise<void> }) {
  const [limit, setLimit] = useState(String(a.daily_limit));
  useEffect(() => setLimit(String(a.daily_limit)), [a.daily_limit]);
  const status = ACCOUNT_STATUS_META[a.status] ?? ACCOUNT_STATUS_META.error;
  const platform = PLATFORM_META[a.platform];
  const tone = healthTone(a.health_score);
  const effLimit = effectiveDailyLimit(a);

  const commitLimit = () => {
    const n = Number(limit);
    if (!Number.isInteger(n) || n < 0) {
      setLimit(String(a.daily_limit));
      return;
    }
    if (n === a.daily_limit) return;
    void run("Лимит обновлён", () => pub.updateAccount(a.id, { daily_limit: n }));
  };

  const onDisconnect = () => {
    if (!window.confirm(`Отключить аккаунт «${a.account_name}»? Задания в очереди будут отменены.`)) return;
    void run("Аккаунт отключён", () => pub.disconnect(a.id));
  };

  return (
    <TableRow>
      <TableCell className="min-w-[180px]">
        <div className="font-medium">{a.account_name}</div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {a.handle && <span>@{a.handle}</span>}
          {platform && <Chip label={platform.label} cls={platform.cls} />}
        </div>
        {a.last_error && <div className="mt-1 max-w-[220px] truncate text-xs text-destructive" title={a.last_error}>{a.last_error}</div>}
        {metricsScopeHint(a) && <div className="mt-1 text-xs text-amber-700">{metricsScopeHint(a)}</div>}
      </TableCell>
      <TableCell><Chip label={status.label} cls={status.cls} /></TableCell>
      <TableCell>
        <Select
          value={a.group_id ?? NONE}
          disabled={disabled}
          onValueChange={(v) => void run("Группа обновлена", () => pub.updateAccount(a.id, { group_id: v === NONE ? null : v }))}
        >
          <SelectTrigger className="h-8 w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Без группы</SelectItem>
            {pub.groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Select
          value={a.persona_id ?? NONE}
          disabled={disabled}
          onValueChange={(v) => void run("Персона обновлена", () => pub.updateAccount(a.id, { persona_id: v === NONE ? null : v }))}
        >
          <SelectTrigger className="h-8 w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Без персоны</SelectItem>
            {pub.personas.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Input
          type="number"
          min={0}
          aria-label={`Лимит в день для ${a.account_name}`}
          className="h-8 w-20"
          value={limit}
          disabled={disabled}
          onChange={(e) => setLimit(e.target.value)}
          onBlur={commitLimit}
        />
      </TableCell>
      <TableCell className="min-w-[170px]">
        <div className="flex items-center gap-2">
          <Switch
            checked={a.ramp_enabled}
            disabled={disabled}
            aria-label={`Разгон для ${a.account_name}`}
            onCheckedChange={(v) => void run(v ? "Разгон включён" : "Разгон выключен", () => pub.updateAccount(a.id, { ramp_enabled: v }))}
          />
          <span className="text-xs text-muted-foreground">{rampLabel(a)}</span>
        </div>
      </TableCell>
      <TableCell className="min-w-[130px]">
        <div className="flex items-center gap-2">
          <Progress value={a.health_score} className={cn("h-2 w-20", HEALTH_CLS[tone])} aria-label="Здоровье аккаунта" />
          <span className="text-xs tabular-nums">{Math.round(a.health_score)}</span>
        </div>
      </TableCell>
      <TableCell className="tabular-nums">{a.published_today} / {effLimit}</TableCell>
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmtDate(a.last_post_at)}</TableCell>
      <TableCell>
        <Switch
          checked={a.publish_enabled}
          disabled={disabled}
          aria-label={`Публикации для ${a.account_name}`}
          onCheckedChange={(v) => void run(v ? "Публикации включены" : "Публикации выключены", () => pub.updateAccount(a.id, { publish_enabled: v }))}
        />
      </TableCell>
      <TableCell>
        <Button variant="ghost" size="sm" className="text-destructive" disabled={disabled} onClick={onDisconnect}>
          Отключить
        </Button>
      </TableCell>
    </TableRow>
  );
}

/* ───────────────────────────── группы ───────────────────────────── */

type GroupDraft = {
  id?: string;
  name: string;
  account_ids: string[];
  platform: PublishPlatform | typeof NONE;
  publish_strategy: PublishStrategy;
  per_hour: string;
  persona_id: string;
  review_mode: ReviewMode;
  timezone: string;
  window_start: string;
  window_end: string;
  min_gap_minutes: string;
  jitter_minutes: string;
};

const EMPTY_GROUP: GroupDraft = {
  name: "",
  account_ids: [],
  platform: NONE,
  publish_strategy: "drip",
  per_hour: "",
  persona_id: NONE,
  review_mode: "review_required",
  timezone: "Asia/Almaty",
  window_start: "",
  window_end: "",
  min_gap_minutes: "",
  jitter_minutes: "",
};

function groupToDraft(g: PublishGroup): GroupDraft {
  return {
    id: g.id,
    name: g.name,
    account_ids: g.account_ids ?? [],
    platform: g.platform ?? NONE,
    publish_strategy: g.publish_strategy,
    per_hour: g.per_hour != null ? String(g.per_hour) : "",
    persona_id: g.persona_id ?? NONE,
    review_mode: g.review_mode,
    timezone: g.timezone ?? "",
    window_start: g.window_start?.slice(0, 5) ?? "",
    window_end: g.window_end?.slice(0, 5) ?? "",
    min_gap_minutes: g.min_gap_minutes != null ? String(g.min_gap_minutes) : "",
    jitter_minutes: g.jitter_minutes != null ? String(g.jitter_minutes) : "",
  };
}

function GroupsTab({ pub }: { pub: UsePublishing }) {
  const disabled = pub.busy != null;
  const [draft, setDraft] = useState<GroupDraft | null>(null);
  const selected = draft?.id ? pub.groups.find((g) => g.id === draft.id) : null;
  const set = <K extends keyof GroupDraft>(k: K, v: GroupDraft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      toast.error("Название группы обязательно");
      return;
    }
    try {
      await pub.groupUpsert({
        id: draft.id,
        name: draft.name.trim(),
        account_ids: draft.account_ids,
        platform: draft.platform === NONE ? null : draft.platform,
        publish_strategy: draft.publish_strategy,
        per_hour: numOrUndef(draft.per_hour),
        persona_id: draft.persona_id === NONE ? null : draft.persona_id,
        review_mode: draft.review_mode,
        timezone: draft.timezone.trim() || null,
        window_start: draft.window_start || null,
        window_end: draft.window_end || null,
        min_gap_minutes: numOrUndef(draft.min_gap_minutes),
        jitter_minutes: numOrUndef(draft.jitter_minutes),
      });
      toast.success("Группа сохранена");
      setDraft(null);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const remove = async (g: PublishGroup) => {
    if (!window.confirm(`Удалить группу «${g.name}»? Аккаунты останутся, но выйдут из группы.`)) return;
    try {
      await pub.groupDelete(g.id);
      toast.success("Группа удалена");
      if (draft?.id === g.id) setDraft(null);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <div className="space-y-2">
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => setDraft({ ...EMPTY_GROUP })}>
          <Plus className="mr-1.5 h-4 w-4" /> Новая группа
        </Button>
        {!pub.groups.length && <EmptyState text="Групп нет — группа объединяет аккаунты с общей стратегией и окном публикации." />}
        {pub.groups.map((g) => {
          const rm = REVIEW_MODE_META[g.review_mode];
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => setDraft(groupToDraft(g))}
              className={cn(
                "w-full rounded-2xl border bg-card p-3 text-left transition hover:bg-muted/50",
                draft?.id === g.id && "ring-2 ring-primary",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{g.name}</span>
                {rm && <Chip label={rm.label} cls={rm.cls} />}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {g.account_ids?.length ?? 0} акк. · {STRATEGY_META[g.publish_strategy]?.label ?? g.publish_strategy}
                {g.platform ? ` · ${PLATFORM_META[g.platform].label}` : ""} · одобрено подряд: {g.approved_streak}
              </div>
            </button>
          );
        })}
      </div>

      {draft ? (
        <div className="space-y-4 rounded-2xl border bg-card p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">{draft.id ? "Редактирование группы" : "Новая группа"}</h3>
            {selected && <span className="text-xs text-muted-foreground">Одобрено подряд: {selected.approved_streak}</span>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Название">
              <Input value={draft.name} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field label="Платформа">
              <Select value={draft.platform} onValueChange={(v) => set("platform", v as GroupDraft["platform"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Любая</SelectItem>
                  {(Object.keys(PLATFORM_META) as PublishPlatform[]).map((p) => (
                    <SelectItem key={p} value={p}>{PLATFORM_META[p].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Стратегия">
              <Select value={draft.publish_strategy} onValueChange={(v) => set("publish_strategy", v as PublishStrategy)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(STRATEGY_META) as PublishStrategy[]).map((s) => (
                    <SelectItem key={s} value={s}>{STRATEGY_META[s].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Постов в час (drip)">
              <Input type="number" min={0} value={draft.per_hour} onChange={(e) => set("per_hour", e.target.value)} />
            </Field>
            <Field label="Персона">
              <Select value={draft.persona_id} onValueChange={(v) => set("persona_id", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Без персоны</SelectItem>
                  {pub.personas.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Согласование">
              <Select value={draft.review_mode} onValueChange={(v) => set("review_mode", v as ReviewMode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(REVIEW_MODE_META) as ReviewMode[]).map((r) => (
                    <SelectItem key={r} value={r}>{REVIEW_MODE_META[r].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Часовой пояс">
              <Input value={draft.timezone} placeholder="Asia/Almaty" onChange={(e) => set("timezone", e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Окно с">
                <Input type="time" value={draft.window_start} onChange={(e) => set("window_start", e.target.value)} />
              </Field>
              <Field label="Окно до">
                <Input type="time" value={draft.window_end} onChange={(e) => set("window_end", e.target.value)} />
              </Field>
            </div>
            <Field label="Мин. интервал, мин">
              <Input type="number" min={0} value={draft.min_gap_minutes} onChange={(e) => set("min_gap_minutes", e.target.value)} />
            </Field>
            <Field label="Джиттер, мин">
              <Input type="number" min={0} value={draft.jitter_minutes} onChange={(e) => set("jitter_minutes", e.target.value)} />
            </Field>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Аккаунты</Label>
            {!pub.accounts.length ? (
              <p className="mt-1 text-sm text-muted-foreground">Нет подключённых аккаунтов.</p>
            ) : (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {pub.accounts.map((a) => {
                  const checked = draft.account_ids.includes(a.id);
                  return (
                    <label key={a.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) =>
                          set("account_ids", v ? [...draft.account_ids, a.id] : draft.account_ids.filter((x) => x !== a.id))
                        }
                      />
                      <span className="truncate">{a.account_name}</span>
                      <span className="text-xs text-muted-foreground">{PLATFORM_META[a.platform]?.label}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void save()} disabled={disabled}>
              {pub.busy === "group_upsert" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Сохранить
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)} disabled={disabled}>Отмена</Button>
            {selected && (
              <Button variant="ghost" className="ml-auto text-destructive" disabled={disabled} onClick={() => void remove(selected)}>
                <Trash2 className="mr-1.5 h-4 w-4" /> Удалить
              </Button>
            )}
          </div>
        </div>
      ) : (
        <EmptyState text="Выберите группу слева или создайте новую." />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/* ───────────────────────────── персоны ───────────────────────────── */

type PersonaDraft = {
  id?: string;
  name: string;
  description: string;
  niche: string;
  tone_of_voice: string;
  forbidden_phrases: string;
  language: string;
  engine_default: PersonaEngine;
  heygen_avatar_id: string;
  heygen_voice_id: string;
  eleven_voice_id: string;
  reels_theme: string;
  caption_style: string;
};

const EMPTY_PERSONA: PersonaDraft = {
  name: "",
  description: "",
  niche: "",
  tone_of_voice: "",
  forbidden_phrases: "",
  language: "ru",
  engine_default: "heygen",
  heygen_avatar_id: "",
  heygen_voice_id: "",
  eleven_voice_id: "",
  reels_theme: "",
  caption_style: "",
};

function personaToDraft(p: Persona): PersonaDraft {
  return {
    id: p.id,
    name: p.name,
    description: p.description ?? "",
    niche: p.niche ?? "",
    tone_of_voice: p.tone_of_voice ?? "",
    forbidden_phrases: (p.forbidden_phrases ?? []).join(", "),
    language: p.language ?? "",
    engine_default: p.engine_default,
    heygen_avatar_id: p.heygen_avatar_id ?? "",
    heygen_voice_id: p.heygen_voice_id ?? "",
    eleven_voice_id: p.eleven_voice_id ?? "",
    reels_theme: p.reels_theme ?? "",
    caption_style: p.caption_style ?? "",
  };
}

function PersonasTab({ pub }: { pub: UsePublishing }) {
  const disabled = pub.busy != null;
  const [draft, setDraft] = useState<PersonaDraft | null>(null);
  const set = <K extends keyof PersonaDraft>(k: K, v: PersonaDraft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const orNull = (s: string) => s.trim() || null;

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      toast.error("Имя персоны обязательно");
      return;
    }
    try {
      await pub.personaUpsert({
        id: draft.id,
        name: draft.name.trim(),
        description: orNull(draft.description),
        niche: orNull(draft.niche),
        tone_of_voice: orNull(draft.tone_of_voice),
        forbidden_phrases: splitCsv(draft.forbidden_phrases),
        language: orNull(draft.language),
        engine_default: draft.engine_default,
        heygen_avatar_id: orNull(draft.heygen_avatar_id),
        heygen_voice_id: orNull(draft.heygen_voice_id),
        eleven_voice_id: orNull(draft.eleven_voice_id),
        reels_theme: orNull(draft.reels_theme),
        caption_style: orNull(draft.caption_style),
      });
      toast.success("Персона сохранена");
      setDraft(null);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const remove = async (p: Persona) => {
    if (!window.confirm(`Удалить персону «${p.name}»?`)) return;
    try {
      await pub.personaDelete(p.id);
      toast.success("Персона удалена");
      if (draft?.id === p.id) setDraft(null);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const textFields: { key: keyof PersonaDraft; label: string; area?: boolean }[] = [
    { key: "name", label: "Имя" },
    { key: "niche", label: "Ниша" },
    { key: "language", label: "Язык" },
    { key: "heygen_avatar_id", label: "HeyGen avatar id" },
    { key: "heygen_voice_id", label: "HeyGen voice id" },
    { key: "eleven_voice_id", label: "ElevenLabs voice id" },
    { key: "reels_theme", label: "Тема Reels" },
    { key: "caption_style", label: "Стиль подписей" },
    { key: "description", label: "Описание", area: true },
    { key: "tone_of_voice", label: "Тон голоса", area: true },
    { key: "forbidden_phrases", label: "Запретные фразы (через запятую)", area: true },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <div className="space-y-2">
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => setDraft({ ...EMPTY_PERSONA })}>
          <Plus className="mr-1.5 h-4 w-4" /> Новая персона
        </Button>
        {!pub.personas.length && <EmptyState text="Персон нет — персона задаёт голос, нишу и движок генерации для аккаунтов." />}
        {pub.personas.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setDraft(personaToDraft(p))}
            className={cn(
              "w-full rounded-2xl border bg-card p-3 text-left transition hover:bg-muted/50",
              draft?.id === p.id && "ring-2 ring-primary",
            )}
          >
            <div className="font-medium">{p.name}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {ENGINE_META[p.engine_default]?.label ?? p.engine_default}
              {p.niche ? ` · ${p.niche}` : ""}
              {p.language ? ` · ${p.language}` : ""}
            </div>
          </button>
        ))}
      </div>

      {draft ? (
        <div className="space-y-4 rounded-2xl border bg-card p-4">
          <h3 className="font-semibold">{draft.id ? "Редактирование персоны" : "Новая персона"}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {textFields.filter((f) => !f.area).map((f) => (
              <Field key={f.key} label={f.label}>
                <Input value={draft[f.key] as string} onChange={(e) => set(f.key, e.target.value as never)} />
              </Field>
            ))}
            <Field label="Движок по умолчанию">
              <Select value={draft.engine_default} onValueChange={(v) => set("engine_default", v as PersonaEngine)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(ENGINE_META) as PersonaEngine[]).map((e) => (
                    <SelectItem key={e} value={e}>{ENGINE_META[e].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          {textFields.filter((f) => f.area).map((f) => (
            <Field key={f.key} label={f.label}>
              <Textarea rows={2} value={draft[f.key] as string} onChange={(e) => set(f.key, e.target.value as never)} />
            </Field>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void save()} disabled={disabled}>
              {pub.busy === "persona_upsert" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Сохранить
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)} disabled={disabled}>Отмена</Button>
            {draft.id && (
              <Button
                variant="ghost"
                className="ml-auto text-destructive"
                disabled={disabled}
                onClick={() => {
                  const p = pub.personas.find((x) => x.id === draft.id);
                  if (p) void remove(p);
                }}
              >
                <Trash2 className="mr-1.5 h-4 w-4" /> Удалить
              </Button>
            )}
          </div>
        </div>
      ) : (
        <EmptyState text="Выберите персону слева или создайте новую." />
      )}
    </div>
  );
}

/* ───────────────────────────── сеть: сводка по группам ───────────────────────────── */

function NetworkTab({ pub }: { pub: UsePublishing }) {
  const rows: GroupMetrics[] = pub.metrics?.groups ?? [];
  if (!rows.length) {
    return <EmptyState text="Групп аккаунтов пока нет — создайте их во вкладке «Группы», и здесь появится сводка по каждой." />;
  }
  return (
    <div className="overflow-x-auto rounded-2xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Группа</TableHead>
            <TableHead>Аккаунты</TableHead>
            <TableHead>Здоровье</TableHead>
            <TableHead>Очередь</TableHead>
            <TableHead>За 7 дней</TableHead>
            <TableHead>Охват d3 (7 дн.)</TableHead>
            <TableHead>Ближайший слот</TableHead>
            <TableHead>Одобрено тем</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((g) => {
            const review = REVIEW_MODE_META[g.review_mode];
            const platform = g.platform ? PLATFORM_META[g.platform] : null;
            const tone = healthTone(g.health_avg);
            return (
              <TableRow key={g.group_id}>
                <TableCell className="min-w-[180px]">
                  <div className="font-medium">{g.name}</div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {platform && <Chip label={platform.label} cls={platform.cls} />}
                    {review && <Chip label={review.label} cls={review.cls} />}
                  </div>
                </TableCell>
                <TableCell className="tabular-nums">
                  {g.accounts_active} / {g.accounts_total}
                  {g.accounts_token_expired > 0 && <div className="text-xs text-amber-700">токен истёк: {g.accounts_token_expired}</div>}
                </TableCell>
                <TableCell>
                  {g.health_avg == null ? "—" : (
                    <span className={cn("font-medium tabular-nums", tone === "good" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : "text-destructive")}>
                      {Math.round(g.health_avg)}%
                    </span>
                  )}
                </TableCell>
                <TableCell className="tabular-nums">{g.jobs_queued}</TableCell>
                <TableCell className="tabular-nums">
                  <span className="text-emerald-700">✓ {g.published_7d}</span>
                  {g.failed_7d > 0 && <span className="ml-2 text-destructive">✗ {g.failed_7d}</span>}
                </TableCell>
                <TableCell className="tabular-nums">{g.reach_d3_7d.toLocaleString("ru-RU")}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{fmtDate(g.next_slot_at)}</TableCell>
                <TableCell className="tabular-nums">{g.items_approved}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/* ───────────────────────────── задания ───────────────────────────── */

function JobsTab({ pub }: { pub: UsePublishing }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Label className="text-xs text-muted-foreground">Статус</Label>
        <Select value={pub.jobsStatus} onValueChange={(v) => pub.setJobsStatus(v as PublishJobStatus | "all")}>
          <SelectTrigger className="h-8 w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            {(Object.keys(JOB_STATUS_META) as PublishJobStatus[]).map((s) => (
              <SelectItem key={s} value={s}>{JOB_STATUS_META[s].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {!pub.jobs.length ? (
        <EmptyState text="Заданий нет — они появятся после «Залить видео» или из конвейера контента." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Статус</TableHead>
                <TableHead>Аккаунт</TableHead>
                <TableHead>Видео</TableHead>
                <TableHead>Запланировано</TableHead>
                <TableHead>Попыток</TableHead>
                <TableHead>Ошибка</TableHead>
                <TableHead>Пост</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pub.jobs.map((j) => {
                const st = JOB_STATUS_META[j.status] ?? JOB_STATUS_META.pending;
                return (
                  <TableRow key={j.id}>
                    <TableCell><Chip label={st.label} cls={st.cls} /></TableCell>
                    <TableCell>
                      <div className="font-medium">{j.publish_accounts?.account_name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">
                        {j.publish_accounts?.handle ? `@${j.publish_accounts.handle} · ` : ""}{PLATFORM_META[j.platform]?.label}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[240px] truncate" title={j.publish_videos?.file_url}>
                      {j.publish_videos?.title || j.publish_videos?.file_url?.split("/").pop() || "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{fmtDate(j.scheduled_at)}</TableCell>
                    <TableCell className="tabular-nums">{j.attempts}</TableCell>
                    <TableCell className="max-w-[260px] text-xs">
                      {j.error_code || j.error_message ? (
                        <span className="text-destructive" title={j.error_message ?? undefined}>
                          {j.error_code && <code className="mr-1">{j.error_code}</code>}
                          <span className="line-clamp-2">{j.error_message}</span>
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      {j.external_post_url ? (
                        <a href={j.external_post_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline">
                          Открыть <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── настройки ───────────────────────────── */

function SettingsTab({ pub }: { pub: UsePublishing }) {
  const disabled = pub.busy != null;
  const s = pub.settings;
  const [notify, setNotify] = useState<NotifyMode>("digest");
  const [chat, setChat] = useState("");
  const [daily, setDaily] = useState("");
  const [monthly, setMonthly] = useState("");
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!s) return;
    setNotify(s.settings.notify_mode);
    setChat(s.settings.digest_chat_id ?? "");
    setDaily(String(s.budget.daily_usd));
    setMonthly(String(s.budget.monthly_usd));
    setPaused(Boolean(s.settings.paused));
  }, [s]);

  if (!s) return <EmptyState text="Настройки не загружены — выберите проект или обновите страницу." />;

  const save = async () => {
    try {
      await pub.settingsUpsert({
        notify_mode: notify,
        digest_chat_id: chat.trim() || null,
        daily_usd: numOrUndef(daily),
        monthly_usd: numOrUndef(monthly),
      });
      toast.success("Настройки сохранены");
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  // Пауза применяется сразу, отдельно от формы: это аварийный рубильник.
  const togglePause = async (next: boolean) => {
    setPaused(next);
    try {
      await pub.settingsUpsert({ paused: next });
      toast.success(next ? "Публикации приостановлены" : "Публикации возобновлены");
    } catch (e) {
      setPaused(!next);
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="max-w-xl space-y-4 rounded-2xl border bg-card p-4">
      <div className={cn("flex items-center justify-between gap-3 rounded-xl border p-3", paused ? "border-amber-500/40 bg-amber-500/10" : "border-border")}>
        <div>
          <div className="text-sm font-medium">Пауза публикаций проекта</div>
          <div className="text-xs text-muted-foreground">Воркер не берёт задания, новые слоты не планируются. Очередь сохраняется.</div>
        </div>
        <Switch checked={paused} disabled={disabled} onCheckedChange={(v) => void togglePause(v)} aria-label="Пауза публикаций проекта" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Уведомления">
          <Select value={notify} onValueChange={(v) => setNotify(v as NotifyMode)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(NOTIFY_MODE_META) as NotifyMode[]).map((m) => (
                <SelectItem key={m} value={m}>{NOTIFY_MODE_META[m].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Telegram chat id для дайджеста">
          <Input value={chat} placeholder="-100…" onChange={(e) => setChat(e.target.value)} />
        </Field>
        <Field label="Бюджет в день, $">
          <Input type="number" min={0} step="0.01" value={daily} onChange={(e) => setDaily(e.target.value)} />
        </Field>
        <Field label="Бюджет в месяц, $">
          <Input type="number" min={0} step="0.01" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
        </Field>
      </div>
      <div className="text-sm text-muted-foreground">
        Расход: сегодня <b className="text-foreground">${s.spend.today_usd.toFixed(2)}</b>, за месяц{" "}
        <b className="text-foreground">${s.spend.month_usd.toFixed(2)}</b> · параллельных воркеров: {s.settings.max_parallel_workers}
      </div>
      <Button onClick={() => void save()} disabled={disabled}>
        {pub.busy === "settings_upsert" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Сохранить
      </Button>
    </div>
  );
}

/* ───────────────────────────── диалоги ───────────────────────────── */

function ConnectInstagramDialog({ open, onClose, pub }: { open: boolean; onClose: () => void; pub: UsePublishing }) {
  const [pages, setPages] = useState<AvailablePage[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const disabled = pub.busy != null;

  useEffect(() => {
    if (!open) return;
    setPages(null);
    setPicked([]);
    setErr(null);
    pub.loadAvailable()
      .then((r) => setPages(r.pages ?? []))
      .catch((e) => setErr(errMsg(e, "Не удалось получить страницы Meta")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const connectable = (pages ?? []).filter((p) => p.connectable && !p.already_connected);

  const submit = async () => {
    if (!picked.length) return;
    try {
      const r = await pub.connect(picked);
      const skipped = r.skipped?.length ? `, пропущено: ${r.skipped.length}` : "";
      toast.success(`Подключено: ${r.connected?.length ?? 0}${skipped}`);
      onClose();
    } catch (e) {
      setErr(errMsg(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Подключить Instagram</DialogTitle>
          <DialogDescription>Страницы Facebook с привязанным Instagram-аккаунтом из подключённого Meta-токена проекта.</DialogDescription>
        </DialogHeader>
        {err && <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{err}</div>}
        {!err && pages == null && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Загрузка страниц…</div>
        )}
        {pages != null && !connectable.length && !err && (
          <p className="text-sm text-muted-foreground">Нет страниц для подключения — все доступные уже подключены или без Instagram-аккаунта.</p>
        )}
        {connectable.length > 0 && (
          <div className="space-y-2">
            {connectable.map((p) => (
              <label key={p.page_id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={picked.includes(p.page_id)}
                  onCheckedChange={(v) => setPicked((s) => (v ? [...s, p.page_id] : s.filter((x) => x !== p.page_id)))}
                />
                <span className="font-medium">{p.ig_username ? `@${p.ig_username}` : p.ig_name ?? p.page_name}</span>
                <span className="text-xs text-muted-foreground">{p.page_name}</span>
              </label>
            ))}
          </div>
        )}
        {pages != null && pages.some((p) => p.already_connected) && (
          <p className="text-xs text-muted-foreground">Уже подключено: {pages.filter((p) => p.already_connected).length}</p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={disabled}>Отмена</Button>
          <Button onClick={() => void submit()} disabled={disabled || !picked.length}>
            {pub.busy === "connect" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Подключить ({picked.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConnectThreadsDialog({ open, onClose, pub }: { open: boolean; onClose: () => void; pub: UsePublishing }) {
  const [userId, setUserId] = useState("");
  const [token, setToken] = useState("");
  const [group, setGroup] = useState(NONE);
  const [err, setErr] = useState<string | null>(null);
  const disabled = pub.busy != null;

  useEffect(() => {
    if (open) {
      setUserId("");
      setToken("");
      setGroup(NONE);
      setErr(null);
    }
  }, [open]);

  const submit = async () => {
    if (!/^\d{5,}$/.test(userId.trim())) {
      setErr("threads_user_id — числовой id пользователя Threads");
      return;
    }
    if (!token.trim()) {
      setErr("Укажите access_token");
      return;
    }
    try {
      const r = await pub.connectThreads({
        threads_user_id: userId.trim(),
        access_token: token.trim(),
        group_id: group === NONE ? undefined : group,
      });
      toast.success(`Подключён ${r.account?.account_name ?? "Threads"}`);
      onClose();
    } catch (e) {
      setErr(errMsg(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Подключить Threads</DialogTitle>
          <DialogDescription>Долгоживущий токен Threads API и числовой id пользователя.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="threads_user_id">
            <Input value={userId} inputMode="numeric" onChange={(e) => setUserId(e.target.value)} />
          </Field>
          <Field label="access_token">
            <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} />
          </Field>
          <Field label="Группа (необязательно)">
            <Select value={group} onValueChange={setGroup}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Без группы</SelectItem>
                {pub.groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          {err && <p className="text-sm text-destructive">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={disabled}>Отмена</Button>
          <Button onClick={() => void submit()} disabled={disabled}>
            {pub.busy === "connect_threads" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Подключить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const ALL_ACTIVE = "__all"; // все включённые аккаунты вместо группы

function PublishVideoDialog({ open, onClose, pub }: { open: boolean; onClose: () => void; pub: UsePublishing }) {
  const [fileUrl, setFileUrl] = useState("");
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [group, setGroup] = useState(ALL_ACTIVE);
  const [mode, setMode] = useState<PublishMode>("drip");
  const [err, setErr] = useState<string | null>(null);
  const disabled = pub.busy != null;

  useEffect(() => {
    if (open) {
      setFileUrl("");
      setTitle("");
      setCaption("");
      setHashtags("");
      setGroup(pub.groups[0]?.id ?? ALL_ACTIVE);
      setMode("drip");
      setErr(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const activeIds = useMemo(() => pub.accounts.filter((a) => a.publish_enabled && a.status === "active").map((a) => a.id), [pub.accounts]);

  const submit = async () => {
    const v = validateFileUrl(fileUrl);
    if (v) {
      setErr(v);
      toast.error(v);
      return;
    }
    if (group === ALL_ACTIVE && !activeIds.length) {
      const m = "Нет активных аккаунтов — подключите аккаунт или выберите группу";
      setErr(m);
      toast.error(m);
      return;
    }
    try {
      const r = await pub.publishVideo({
        file_url: fileUrl.trim(),
        title: title.trim() || undefined,
        caption: caption.trim() || undefined,
        hashtags: splitCsv(hashtags).map((h) => h.replace(/^#/, "")),
        mode,
        ...(group === ALL_ACTIVE ? { account_ids: activeIds } : { group_id: group }),
      });
      toast.success(`Создано заданий: ${r.created}${r.skipped ? `, пропущено: ${r.skipped}` : ""}`);
      onClose();
    } catch (e) {
      setErr(errMsg(e));
      toast.error(errMsg(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Залить видео</DialogTitle>
          <DialogDescription>Ссылка на готовый ролик — задания разложатся по аккаунтам группы с учётом лимитов и окна.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Ссылка на видео (https, .mp4/.mov)">
            <Input value={fileUrl} placeholder="https://…/video.mp4" onChange={(e) => setFileUrl(e.target.value)} aria-label="Ссылка на видео" />
          </Field>
          <Field label="Название">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Подпись">
            <Textarea rows={3} value={caption} onChange={(e) => setCaption(e.target.value)} />
          </Field>
          <Field label="Хэштеги (через запятую)">
            <Input value={hashtags} placeholder="маркетинг, reels" onChange={(e) => setHashtags(e.target.value)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Группа">
              <Select value={group} onValueChange={setGroup}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_ACTIVE}>Все активные аккаунты ({activeIds.length})</SelectItem>
                  {pub.groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Режим">
              <Select value={mode} onValueChange={(v) => setMode(v as PublishMode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(PUBLISH_MODE_META) as PublishMode[]).map((m) => (
                    <SelectItem key={m} value={m}>{PUBLISH_MODE_META[m].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={disabled}>Отмена</Button>
          <Button onClick={() => void submit()} disabled={disabled}>
            {pub.busy === "publish_video" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Создать задания
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
