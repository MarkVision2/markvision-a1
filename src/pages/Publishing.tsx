import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertCircle, ChevronDown, ExternalLink, Instagram, KeyRound, Loader2, PauseCircle, Plus, RefreshCw, Search, Send, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { AccountPicker } from "@/components/publishing/AccountPicker";
import { BulkAccountsBar } from "@/components/publishing/BulkAccountsBar";
import { AccountsTable } from "@/components/publishing/AccountsTable";
import { ConnectedAccountsTab } from "@/components/publishing/ConnectedAccountsTab";
import { JobsTab } from "@/components/publishing/JobsTab";
import { NetworkTab } from "@/components/publishing/NetworkTab";
import { UploadPublishDialog } from "@/components/publishing/UploadPublishDialog";
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
  formatFollowers,
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
import { ANY, EMPTY_FILTERS, filterAccounts, type AccountFilters } from "@/lib/publishingSelection";
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
              <Button variant="ghost" size="sm" onClick={() => void pub.refetch()} disabled={disabled || pub.loading} aria-label="Обновить">
                <RefreshCw className={cn("h-4 w-4", pub.loading && "animate-spin")} />
              </Button>
              {/* Пять одинаковых кнопок в шапке кричали наперебой — площадки под одним меню. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={disabled || !projectId || oauthBusy != null}>
                    {oauthBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}
                    Подключить аккаунт
                    <ChevronDown className="ml-1.5 h-3.5 w-3.5 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onSelect={() => setDialog("instagram")}>Instagram</DropdownMenuItem>
                  {(["threads", "tiktok", "youtube"] as OAuthPlatform[]).map((pl) => (
                    <DropdownMenuItem key={pl} onSelect={() => void connectOAuth(pl)}>{OAUTH_LABELS[pl]}</DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setDialog("threads")}>
                    <KeyRound className="mr-2 h-3.5 w-3.5" /> Threads по токену
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
            <TabsTrigger value="connected">Подключённые</TabsTrigger>
            <TabsTrigger value="network">Сеть</TabsTrigger>
            <TabsTrigger value="groups">Группы</TabsTrigger>
            <TabsTrigger value="personas">Персоны</TabsTrigger>
            <TabsTrigger value="jobs">Задания</TabsTrigger>
            <TabsTrigger value="settings">Настройки</TabsTrigger>
          </TabsList>
          <TabsContent value="accounts" className="mt-4"><AccountsTable pub={pub} /></TabsContent>
          <TabsContent value="connected" className="mt-4">
            <ConnectedAccountsTab rows={pub.metrics?.accounts ?? []} groups={pub.groups} />
          </TabsContent>
          <TabsContent value="network" className="mt-4"><NetworkTab rows={pub.metrics?.groups ?? []} /></TabsContent>
          <TabsContent value="groups" className="mt-4"><GroupsTab pub={pub} /></TabsContent>
          <TabsContent value="personas" className="mt-4"><PersonasTab pub={pub} /></TabsContent>
          <TabsContent value="jobs" className="mt-4"><JobsTab pub={pub} /></TabsContent>
          <TabsContent value="settings" className="mt-4"><SettingsTab pub={pub} /></TabsContent>
        </Tabs>
      </div>

      <ConnectInstagramDialog open={dialog === "instagram"} onClose={() => setDialog(null)} pub={pub} />
      <ConnectThreadsDialog open={dialog === "threads"} onClose={() => setDialog(null)} pub={pub} />
      <UploadPublishDialog open={dialog === "video"} onClose={() => setDialog(null)} pub={pub} />
    </PageContainer>
  );
}

/* ───────────────────────────── сводка ───────────────────────────── */

function SummaryTiles({ pub }: { pub: UsePublishing }) {
  const m = pub.metrics?.publish;
  const spend = m?.spent_month_usd ?? pub.settings?.spend.month_usd ?? null;

  // Тон подсвечивает только то, что требует реакции: семь одинаково громких
  // плиток с нулями не давали понять, куда смотреть.
  const tiles: { label: string; value: string; hint?: string; tone?: "warn" | "bad" }[] = [
    { label: "Активных аккаунтов", value: m ? `${m.accounts_active} / ${m.accounts_total}` : "—" },
    { label: "В очереди", value: m ? String(m.jobs_queued) : "—", hint: m?.jobs_processing ? `публикуется: ${m.jobs_processing}` : undefined },
    { label: "Опубликовано за 24 ч", value: m ? String(m.published_24h) : "—" },
    {
      label: "Ошибок за 24 ч",
      value: m ? String(m.failed_24h) : "—",
      hint: m?.manual_review ? `на ручной проверке: ${m.manual_review}` : undefined,
      tone: m?.failed_24h ? "bad" : undefined,
    },
    { label: "Среднее здоровье", value: m?.health_avg != null ? `${Math.round(m.health_avg)}%` : "—", tone: m?.health_avg != null && m.health_avg < 70 ? "warn" : undefined },
    { label: "Токены истекают", value: m ? String(m.tokens_expiring_7d) : "—", hint: "за 7 дней", tone: m?.tokens_expiring_7d ? "warn" : undefined },
    { label: "Расход за месяц", value: spend != null ? `$${spend.toFixed(2)}` : "—" },
  ];

  return (
    <div className="grid grid-cols-2 divide-x divide-y overflow-hidden rounded-2xl border bg-card sm:grid-cols-4 xl:grid-cols-7 xl:divide-y-0">
      {tiles.map((t) => (
        <div key={t.label} className="px-4 py-3">
          <div className="truncate text-xs text-muted-foreground">{t.label}</div>
          <div
            className={cn(
              "mt-0.5 text-xl font-semibold tabular-nums",
              t.tone === "bad" && "text-destructive",
              t.tone === "warn" && "text-amber-600 dark:text-amber-400",
            )}
          >
            {t.value}
          </div>
          <div className="truncate text-xs text-muted-foreground">{t.hint ?? "\u00A0"}</div>
        </div>
      ))}
    </div>
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

/**
 * Состав группы = объединение двух источников: publish_accounts.group_id
 * (селект в «Аккаунтах») и group.account_ids (галочки в форме). Так же
 * считают плановщик и витрина «Сеть» — иначе карточка врёт про «0 акк.».
 */
function groupMemberIds(g: PublishGroup, accounts: PublishAccount[]): string[] {
  const ids = new Set(g.account_ids ?? []);
  for (const a of accounts) if (a.group_id === g.id) ids.add(a.id);
  return [...ids];
}

function groupToDraft(g: PublishGroup, accounts: PublishAccount[] = []): GroupDraft {
  return {
    id: g.id,
    name: g.name,
    account_ids: groupMemberIds(g, accounts),
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
              onClick={() => setDraft(groupToDraft(g, pub.accounts))}
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
                {groupMemberIds(g, pub.accounts).length} акк. · {STRATEGY_META[g.publish_strategy]?.label ?? g.publish_strategy}
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

function initials(name: string): string {
  const parts = name.replace(/^@/, "").split(/[\s._-]+/).filter(Boolean);
  return (parts.slice(0, 2).map((w) => w[0]).join("") || name.slice(0, 2)).toUpperCase();
}

function PageAvatar({ page }: { page: AvailablePage }) {
  const label = page.ig_username ?? page.ig_name ?? page.page_name;
  return (
    <Avatar className="h-9 w-9 shrink-0 ring-1 ring-border">
      {page.ig_avatar_url && <AvatarImage src={page.ig_avatar_url} alt="" />}
      <AvatarFallback className="bg-gradient-to-br from-pink-500/20 to-amber-500/20 text-xs font-semibold">{initials(label)}</AvatarFallback>
    </Avatar>
  );
}

/**
 * Подключение Instagram-аккаунтов пачкой: страницы Facebook проекта с привязанным
 * Instagram. Строка — целиком кликабельна; уже подключённые и страницы без
 * Instagram показаны отдельно, чтобы список из 100+ страниц читался.
 */
function ConnectInstagramDialog({ open, onClose, pub }: { open: boolean; onClose: () => void; pub: UsePublishing }) {
  const [pages, setPages] = useState<AvailablePage[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showRest, setShowRest] = useState(false);
  const [groupId, setGroupId] = useState<string>(NONE);
  // Запасной путь: сохранённые токены проекта площадка отклонила — пользователь
  // вставляет свежий User Access Token, он идёт и в список страниц, и в подключение.
  const [manualToken, setManualToken] = useState("");
  const [usedToken, setUsedToken] = useState<string | null>(null);
  const disabled = pub.busy != null;

  const load = (token?: string | null) => {
    setPages(null);
    setPicked([]);
    setErr(null);
    pub.loadAvailable(token)
      .then((r) => { setPages(r.pages ?? []); setUsedToken(token ?? null); })
      .catch((e) => { setPages([]); setErr(errMsg(e, "Не удалось получить страницы Meta")); });
  };

  useEffect(() => {
    if (!open) return;
    setManualToken("");
    setUsedToken(null);
    setQuery("");
    setShowRest(false);
    setGroupId(NONE);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const all = pages ?? [];
  const q = query.trim().toLowerCase();
  const matches = (p: AvailablePage) =>
    !q || [p.ig_username, p.ig_name, p.page_name].some((v) => v?.toLowerCase().includes(q));
  const connectable = all.filter((p) => p.connectable && !p.already_connected);
  const connected = all.filter((p) => p.already_connected);
  const noInstagram = all.filter((p) => !p.connectable);
  const visible = connectable.filter(matches);
  const allVisiblePicked = visible.length > 0 && visible.every((p) => picked.includes(p.page_id));

  const toggle = (id: string) => setPicked((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const toggleAll = () => {
    if (allVisiblePicked) setPicked((s) => s.filter((id) => !visible.some((p) => p.page_id === id)));
    else setPicked((s) => Array.from(new Set([...s, ...visible.map((p) => p.page_id)])));
  };

  const submit = async () => {
    if (!picked.length) return;
    try {
      const r = await pub.connect(picked, usedToken, groupId === NONE ? null : groupId);
      const skipped = r.skipped?.length ? `, пропущено: ${r.skipped.length}` : "";
      toast.success(`Подключено: ${r.connected?.length ?? 0}${skipped}`);
      onClose();
    } catch (e) {
      setErr(errMsg(e));
    }
  };

  const Row = ({ p, state }: { p: AvailablePage; state: "pick" | "connected" | "none" }) => {
    const on = picked.includes(p.page_id);
    const inner = (
      <>
        <PageAvatar page={p} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{p.ig_username ? `@${p.ig_username}` : p.ig_name ?? p.page_name}</span>
            {p.ig_followers != null && p.ig_followers > 0 && (
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatFollowers(p.ig_followers)}</span>
            )}
          </div>
          <div className="truncate text-xs text-muted-foreground">{p.page_name}{p.ig_name && p.ig_username ? ` · ${p.ig_name}` : ""}</div>
        </div>
        {state === "pick" && <Checkbox checked={on} tabIndex={-1} aria-hidden className="pointer-events-none" />}
        {state === "connected" && <Badge variant="secondary" className="shrink-0 bg-emerald-500/10 text-emerald-700">Подключён</Badge>}
        {state === "none" && <Badge variant="outline" className="shrink-0 text-muted-foreground">Нет Instagram</Badge>}
      </>
    );
    if (state !== "pick") {
      return <div className="flex items-center gap-3 rounded-xl px-3 py-2 opacity-70">{inner}</div>;
    }
    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={on}
        aria-label={p.ig_username ? `@${p.ig_username}` : p.page_name}
        onClick={() => toggle(p.page_id)}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors",
          on ? "border-primary/50 bg-primary/5" : "border-transparent hover:bg-muted/60",
        )}
      >
        {inner}
      </button>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-pink-500 via-rose-500 to-amber-400 text-white shadow-sm">
              <Instagram className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <DialogTitle>Подключить Instagram</DialogTitle>
              <DialogDescription>
                {pages == null && !err
                  ? "Ищем страницы Facebook с привязанным Instagram…"
                  : connectable.length
                  ? `Доступно ${connectable.length}, уже подключено ${connected.length}. Отметьте аккаунты и нажмите «Подключить».`
                  : "Страницы Facebook с привязанным Instagram-аккаунтом из подключённого Meta-токена проекта."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {err && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{err}</div>}
        {err && (
          <div className="space-y-2 rounded-xl border p-3 text-sm">
            <div className="font-medium">Что делать</div>
            <p className="text-xs text-muted-foreground">
              Площадка не приняла сохранённый Meta-токен проекта. Подключите Facebook заново в{" "}
              <Link to="/settings" className="underline" onClick={onClose}>Настройках → Meta</Link>{" "}
              или вставьте User Access Token (Graph API Explorer) — он будет использован только для этого подключения.
            </p>
            <div className="flex gap-2">
              <Input
                aria-label="User Access Token"
                placeholder="EAAB…"
                value={manualToken}
                onChange={(e) => setManualToken(e.target.value)}
              />
              <Button variant="outline" disabled={disabled || !manualToken.trim()} onClick={() => load(manualToken.trim())}>
                Проверить
              </Button>
            </div>
          </div>
        )}

        {!err && pages == null && (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2">
                <div className="h-9 w-9 animate-pulse rounded-full bg-muted" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
                  <div className="h-2.5 w-1/3 animate-pulse rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        )}

        {pages != null && !err && (
          <div className="space-y-3">
            {connectable.length > 6 && (
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="Поиск страниц"
                  className="pl-9"
                  placeholder="Поиск по @имени или названию страницы"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            )}

            {connectable.length > 0 ? (
              <>
                <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
                  <span>Выбрано <b className="text-foreground">{picked.length}</b> из {connectable.length}</span>
                  <button type="button" className="underline-offset-2 hover:underline" onClick={toggleAll} disabled={!visible.length}>
                    {allVisiblePicked ? "Снять выбор" : q ? `Выбрать найденные (${visible.length})` : "Выбрать все"}
                  </button>
                </div>
                <ScrollArea className="max-h-[46vh] rounded-xl border">
                  <div className="space-y-0.5 p-1.5">
                    {visible.map((p) => <Row key={p.page_id} p={p} state="pick" />)}
                    {visible.length === 0 && (
                      <p className="px-3 py-6 text-center text-sm text-muted-foreground">Ничего не найдено по «{query}»</p>
                    )}
                  </div>
                </ScrollArea>
              </>
            ) : (
              <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                {connected.length
                  ? "Все доступные Instagram-аккаунты уже подключены."
                  : "У страниц этого Meta-токена нет привязанного Instagram Business или Creator."}
              </div>
            )}

            {(connected.length > 0 || noInstagram.length > 0) && (
              <div>
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => setShowRest((v) => !v)}
                >
                  {showRest ? "Скрыть" : "Показать"} остальные ({connected.length + noInstagram.length}): подключено {connected.length}, без Instagram {noInstagram.length}
                </button>
                {showRest && (
                  <div className="mt-2 space-y-0.5 rounded-xl border p-1.5">
                    {connected.map((p) => <Row key={p.page_id} p={p} state="connected" />)}
                    {noInstagram.map((p) => <Row key={p.page_id} p={p} state="none" />)}
                  </div>
                )}
              </div>
            )}

            {connectable.length > 0 && pub.groups.length > 0 && (
              <div className="flex items-center gap-3 rounded-xl border bg-muted/30 px-3 py-2">
                <Label className="shrink-0 text-xs text-muted-foreground">Сразу в группу</Label>
                <Select value={groupId} onValueChange={setGroupId} disabled={disabled}>
                  <SelectTrigger className="h-8" aria-label="Группа для новых аккаунтов"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Без группы</SelectItem>
                    {pub.groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={onClose} disabled={disabled}>Отмена</Button>
          <Button onClick={() => void submit()} disabled={disabled || !picked.length}>
            {pub.busy === "connect" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}
            {picked.length ? `Подключить ${picked.length}` : "Подключить"}
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
