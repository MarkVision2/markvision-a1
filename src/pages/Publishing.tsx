import { cloneElement, isValidElement, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertCircle, ChevronDown, ExternalLink, Instagram, KeyRound, Link2, Loader2, PauseCircle, Plus, RefreshCw, Send, Trash2, Upload } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AccountsTable, PLATFORM_DOT } from "@/components/publishing/AccountsTable";
import { JobsTab } from "@/components/publishing/JobsTab";
import { NetworkTab } from "@/components/publishing/NetworkTab";
import { NotificationsPanel } from "@/components/publishing/NotificationsPanel";
import { CampaignsTab } from "@/components/publishing/CampaignsTab";
import { DevicesTab } from "@/components/publishing/DevicesTab";
import { CalendarTab } from "@/components/publishing/CalendarTab";
import { ConnectInstagramDialog } from "@/components/publishing/ConnectInstagramDialog";
import { ConnectLinksDialog } from "@/components/publishing/ConnectLinksDialog";
import { WebhooksSection } from "@/components/publishing/WebhooksSection";
import { RoutinesSection } from "@/components/publishing/RoutinesSection";
import { ProjectRolesSection } from "@/components/publishing/ProjectRolesSection";
import { UploadPublishDialog } from "@/components/publishing/UploadPublishDialog";
import { VideosTab } from "@/components/publishing/VideosTab";
import { usePublishing, type UsePublishing } from "@/hooks/usePublishing";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import {
  ENGINE_META,
  NOTIFY_MODE_META,
  PLATFORM_META,
  REVIEW_MODE_META,
  STRATEGY_META,
  publishingApi,
  readOAuthResult,
  startPublishOAuth,
  type OAuthPlatform,
  type NotifyMode,
  type Persona,
  type PersonaEngine,
  type PublishAccount,
  type PublishGroup,
  type PublishJobStatus,
  type PublishPlatform,
  type PublishStrategy,
  type PublishVideo,
  type ReviewMode,
  roleAllows,
} from "@/lib/publishingClient";
import { fmtRelative } from "@/lib/publishingFormat";
import { cn } from "@/lib/utils";

/* ───────────────────────────── утилиты ───────────────────────────── */

const NONE = "__none"; // Radix Select не принимает пустое значение — сентинел для «не выбрано».

function errMsg(e: unknown, fallback = "Ошибка"): string {
  return e instanceof Error ? e.message : fallback;
}

function splitCsv(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

/** Пустое поле — null («вернуть умолчание»), иначе число; мусор — undefined («не трогать»). */
function numOrNull(s: string): number | null | undefined {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isNaN(n) ? undefined : n;
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">{text}</div>;
}

/**
 * Подпись под вкладкой: что это за сущность и зачем она нужна.
 * «Группа» и «Персона» — внутренние слова этого раздела, и без одной строки
 * объяснения оператор видит колонку с выпадающим списком и не понимает, что там.
 */
function TabIntro({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-muted/30 px-4 py-3 text-sm">
      <span className="font-medium">{title}</span>{" "}
      <span className="text-muted-foreground">{children}</span>
    </div>
  );
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
  const [dialog, setDialog] = useState<"instagram" | "threads" | "video" | "links" | null>(null);
  // Вкладка управляется снаружи: «Задания по видео» из библиотеки переключает на очередь.
  const [tab, setTab] = useState("accounts");
  // Повтор ролика из библиотеки — тот же композер без заливки файла.
  const [repostVideo, setRepostVideo] = useState<PublishVideo | null>(null);
  const [oauthBusy, setOauthBusy] = useState<OAuthPlatform | null>(null);
  // Возврат со входа через Facebook: страницы отложены, нужен выбор (?publish_select=…).
  const [pendingSelect, setPendingSelect] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();

  // Возврат с OAuth площадки: ?publish_connected=… / ?publish_error=… → тост и обновление.
  useEffect(() => {
    // Вход через Facebook закончился списком страниц — открываем выбор.
    const select = params.get("publish_select");
    if (select) {
      setPendingSelect(select);
      setDialog("instagram");
      setParams((p) => { p.delete("publish_select"); return p; }, { replace: true });
      return;
    }
    const result = readOAuthResult(params.toString() ? `?${params.toString()}` : "");
    if (!result) return;
    if (result.connected) {
      toast.success(`Подключён ${PLATFORM_META[result.connected.platform as PublishPlatform]?.label ?? result.connected.platform}${result.connected.account ? `: ${result.connected.account}` : ""}`);
      void pub.refetch();
    } else if (result.error) {
      toast.error(`Подключение не удалось: ${result.error}`);
    }
    setParams((p) => { p.delete("publish_connected"); p.delete("publish_error"); p.delete("account"); return p; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  // groupId — в какую группу положить аккаунт после возврата с площадки (publish-oauth хранит его в state).
  const connectOAuth = async (platform: OAuthPlatform, groupId: string | null = null) => {
    if (!projectId) return;
    setOauthBusy(platform);
    try {
      const url = await startPublishOAuth(projectId, platform, groupId);
      window.location.assign(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось начать подключение");
      setOauthBusy(null);
    }
  };

  return (
    <PageContainer wide>
      <div className="space-y-4">
        <PageHeader
          icon={Send}
          iconAccent="pink"
          title="Сетка аккаунтов"
          description="Все аккаунты площадок проекта: подключение, статусы, статистика и очередь автопубликации."
          actions={
            <>
              <Button variant="ghost" size="sm" onClick={() => void pub.refetch()} disabled={disabled || pub.loading} aria-label="Обновить">
                <RefreshCw className={cn("h-4 w-4", pub.loading && "animate-spin")} />
              </Button>
              {/* Пять одинаковых кнопок в шапке кричали наперебой — площадки под одним меню.
                  Подключение — уровень manage, заливка — publish (RBAC): не по роли — прячем. */}
              {roleAllows(pub.role, "manage") && <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={disabled || !projectId || oauthBusy != null}>
                    {oauthBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}
                    Подключить аккаунт
                    <ChevronDown className="ml-1.5 h-3.5 w-3.5 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onSelect={() => { setPendingSelect(null); setDialog("instagram"); }}>
                    <Instagram className="mr-2 h-3.5 w-3.5" /> Instagram…
                  </DropdownMenuItem>
                  {(["threads", "tiktok", "youtube"] as OAuthPlatform[]).map((pl) => {
                    // Есть группы — даём выбрать, куда положить новый аккаунт (без группы всё равно можно).
                    const groups = pub.groups.filter((g) => !g.platform || g.platform === pl);
                    if (!groups.length) {
                      return <DropdownMenuItem key={pl} onSelect={() => void connectOAuth(pl)}>{OAUTH_LABELS[pl]}</DropdownMenuItem>;
                    }
                    return (
                      <DropdownMenuSub key={pl}>
                        <DropdownMenuSubTrigger>{OAUTH_LABELS[pl]}</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="w-56">
                          <DropdownMenuItem onSelect={() => void connectOAuth(pl)}>Без группы</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {groups.map((g) => (
                            <DropdownMenuItem key={g.id} onSelect={() => void connectOAuth(pl, g.id)}>В группу «{g.name}»</DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    );
                  })}
                  <DropdownMenuSeparator />
                  {/* Вторая дорога: аккаунт не наш и доступа к нему нет — пусть
                      владелец подключит его сам по ссылке. */}
                  <DropdownMenuItem onSelect={() => setDialog("links")}>
                    <Link2 className="mr-2 h-3.5 w-3.5" /> Ссылка для клиента…
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setDialog("threads")}>
                    <KeyRound className="mr-2 h-3.5 w-3.5" /> Threads по токену
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>}
              {/* Пока аккаунты грузятся, композер открылся бы с пустым выбором. */}
              {roleAllows(pub.role, "publish") && <Button size="sm" onClick={() => setDialog("video")} disabled={disabled || pub.loading || !projectId}>
                <Upload className="mr-1.5 h-4 w-4" /> Залить видео
              </Button>}
            </>
          }
        />

        {!projectId && <EmptyState text="Выберите проект, чтобы управлять публикациями." />}

        {projectId && pub.error && (
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

        {projectId && !pub.settings?.settings.paused && (pub.metrics?.publish?.jobs_overdue ?? 0) > 0 && (
          <div className="flex items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Очередь не разбирается: у {pub.metrics?.publish?.jobs_overdue} заданий слот прошёл больше 15 минут назад.
              Проверьте, что публикации проекта не на паузе, а аккаунты активны — иначе задания так и будут ждать.
            </span>
          </div>
        )}

        {projectId && (
          <SummaryBar
            pub={pub}
            onOpen={(next, status) => {
              if (status) { pub.setJobsVideo(null); pub.setJobsStatus(status); }
              setTab(next);
            }}
          />
        )}
        <NotificationsPanel projectId={projectId} refreshKey={pub.jobs.length + pub.accounts.length} />

        {/* Шесть вкладок: статистика по аккаунтам живёт видом внутри «Аккаунтов»,
            сводка по группам — над их настройками, «Видео» — библиотека роликов с
            повтором. Вкладка аккаунтов не размонтируется при переключении —
            поиск, фильтры и выделение живут. */}
        {projectId && <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="accounts">Аккаунты</TabsTrigger>
            <TabsTrigger value="groups">Группы</TabsTrigger>
            <TabsTrigger value="personas">Персоны</TabsTrigger>
            <TabsTrigger value="campaigns">Кампании</TabsTrigger>
            <TabsTrigger value="calendar">Календарь</TabsTrigger>
            <TabsTrigger value="videos">Видео</TabsTrigger>
            <TabsTrigger value="jobs">Задания</TabsTrigger>
            <TabsTrigger value="devices">Устройства</TabsTrigger>
            <TabsTrigger value="settings">Настройки</TabsTrigger>
          </TabsList>
          <TabsContent value="accounts" forceMount className="mt-3 data-[state=inactive]:hidden"><AccountsTable pub={pub} /></TabsContent>
          <TabsContent value="groups" className="mt-3">
            <div className="space-y-4">
              <TabIntro title="Группа — расписание для пачки аккаунтов.">
                Когда публиковать (окно и часовой пояс), как часто (стратегия и темп), нужно ли согласование
                перед выходом. Заливаете ролик на группу — задания сами разложатся по всем её аккаунтам
                с паузами между постами. Без группы аккаунт публикуется по своим настройкам.
              </TabIntro>
              {(pub.metrics?.groups?.length ?? 0) > 0 && (
                <section className="space-y-2">
                  <h3 className="px-1 text-sm font-semibold">Сводка по группам</h3>
                  <NetworkTab rows={pub.metrics?.groups ?? []} />
                </section>
              )}
              <GroupsTab pub={pub} />
            </div>
          </TabsContent>
          <TabsContent value="personas" className="mt-3">
            <div className="space-y-4">
              <TabIntro title="Персона — голос и лицо аккаунта.">
                Ниша, тон, запретные фразы, язык, аватар HeyGen или голос ElevenLabs. Персона нужна там, где
                MarkVision сам сочиняет контент: конвейер тем и Reels берут из неё стиль текста и озвучку.
                На публикацию готового файла она не влияет — можно не заполнять.
              </TabIntro>
              <PersonasTab pub={pub} />
            </div>
          </TabsContent>
          <TabsContent value="videos" className="mt-3 space-y-4">
            <TabIntro title="Видео — библиотека роликов проекта.">
              Всё, что залито вручную, пришло из конвейера контента, монтажа или по API. Отсюда ролик
              выпускается повторно в другие аккаунты и открывается очередь заданий именно по нему.
            </TabIntro>
            <VideosTab
              pub={pub}
              onRepost={(v) => setRepostVideo(v)}
              onShowJobs={(v) => { pub.setJobsVideo(v.id); setTab("jobs"); }}
            />
          </TabsContent>
          <TabsContent value="devices" className="mt-3"><DevicesTab /></TabsContent>
          <TabsContent value="campaigns" className="mt-3"><CampaignsTab pub={pub} /></TabsContent>
          <TabsContent value="calendar" className="mt-3"><CalendarTab pub={pub} /></TabsContent>
          <TabsContent value="jobs" className="mt-3 space-y-4">
            <TabIntro title="Задания — очередь публикаций.">
              Одно задание = один ролик в один аккаунт. «В очереди» ждёт слота, «Публикуется» сейчас в работе,
              «Ошибка» — площадка отказала (причина в колонке «Что происходит»), «Ручная проверка» — нужен человек.
            </TabIntro>
            <JobsTab pub={pub} />
          </TabsContent>
          <TabsContent value="settings" className="mt-3 space-y-4">
            <SettingsTab pub={pub} />
            <RoutinesSection pub={pub} />
            <ProjectRolesSection projectId={pub.projectId} role={pub.role} />
            <WebhooksSection projectId={pub.projectId} />
            <div className="max-w-4xl rounded-2xl border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
              Ключи API и подключение Claude через MCP — в{" "}
              <Link to="/settings?tab=api" className="font-medium text-primary hover:underline">Настройках → API и MCP</Link>.
            </div>
          </TabsContent>
        </Tabs>}
      </div>

      <ConnectInstagramDialog
        open={dialog === "instagram"}
        onClose={() => { setDialog(null); setPendingSelect(null); }}
        pub={pub}
        pendingId={pendingSelect}
      />
      <ConnectLinksDialog open={dialog === "links"} onClose={() => setDialog(null)} pub={pub} />
      <ConnectThreadsDialog open={dialog === "threads"} onClose={() => setDialog(null)} pub={pub} />
      <UploadPublishDialog
        open={dialog === "video" || repostVideo != null}
        video={repostVideo}
        onClose={() => { setDialog(null); setRepostVideo(null); }}
        pub={pub}
      />
    </PageContainer>
  );
}

/* ───────────────────────────── сводка ───────────────────────────── */

function SummaryBar({ pub, onOpen }: { pub: UsePublishing; onOpen: (tab: string, status?: PublishJobStatus) => void }) {
  const m = pub.metrics?.publish;
  const spend = m?.spent_month_usd ?? pub.settings?.spend.month_usd ?? null;
  const today = pub.settings?.spend.today_usd ?? null;
  const budget = pub.settings?.budget.monthly_usd ?? null;

  // Сколько аккаунтов на каждой площадке — будущие TikTok / YouTube / Threads
  // видны сразу, даже пока их ноль.
  const byPlatform = new Map<PublishPlatform, number>();
  for (const a of pub.accounts) byPlatform.set(a.platform, (byPlatform.get(a.platform) ?? 0) + 1);

  const attention = m ? m.accounts_token_expired + m.accounts_limited_or_error : 0;
  const overdue = m?.jobs_overdue ?? 0;

  // Каждая плитка — вход в свой список: «ошибок 3» без клика по ним бесполезно.
  const cells: {
    label: string;
    value: string;
    sub: React.ReactNode;
    hint: string;
    tone?: "warn" | "bad";
    onClick?: () => void;
  }[] = [
    {
      label: "Аккаунты активны",
      value: m ? `${m.accounts_active} / ${m.accounts_total}` : "—",
      hint: "Активен = площадка принимает токен и публикация включена. Остальные подключены, но заданий не получают.",
      sub: (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {(Object.keys(PLATFORM_META) as PublishPlatform[]).map((p) => {
            const n = byPlatform.get(p) ?? 0;
            return (
              <span key={p} aria-label={PLATFORM_META[p].label} className={cn("inline-flex items-center gap-1 tabular-nums", n === 0 && "opacity-50")}>
                <span className={cn("h-1.5 w-1.5 rounded-full", PLATFORM_DOT[p])} aria-hidden />
                {PLATFORM_META[p].label} {n}
              </span>
            );
          })}
        </span>
      ),
      onClick: () => onOpen("accounts"),
    },
    {
      label: "В очереди",
      value: m ? String(m.jobs_queued) : "—",
      hint: overdue
        ? "Слот этих заданий прошёл больше 15 минут назад, а их никто не забрал: разбор очереди встал. Проверьте паузу проекта и живость крона publish-worker."
        : "Задания, которые ждут своего слота. Воркер забирает их по расписанию раз в минуту.",
      // Очередь из 13 заданий выглядела здоровой, даже когда воркер умер и
      // оттуда месяц ничего не уезжало.
      sub: overdue
        ? `просрочено ${overdue} — очередь не разбирается`
        : m?.jobs_processing
        ? `публикуется сейчас: ${m.jobs_processing}`
        : m?.next_slot_at
        ? `ближайший слот ${fmtRelative(m.next_slot_at)}`
        : "заданий на публикацию нет",
      tone: overdue ? "bad" : undefined,
      onClick: () => onOpen("jobs", "pending"),
    },
    {
      label: "Опубликовано за сутки",
      value: m ? String(m.published_24h) : "—",
      hint: "Успешные посты за последние 24 часа. Рядом — сколько заданий упало и сколько ждёт ручного разбора.",
      sub: m
        ? `ошибок ${m.failed_24h}${m.manual_review ? ` · ручная проверка ${m.manual_review}` : ""}`
        : "",
      tone: m?.failed_24h ? "bad" : undefined,
      onClick: () => onOpen("jobs", m?.failed_24h ? "failed" : "published"),
    },
    {
      label: "Здоровье сети",
      value: m?.health_avg != null ? `${Math.round(m.health_avg)}%` : "—",
      hint: "Среднее здоровье подключённых аккаунтов (0–100). Ниже 20 планировщик аккаунт не берёт вовсе.",
      // Нулевые слагаемые не пишем: «токены истекают у 0» — шум, из-за которого
      // строка переносилась и прятала важную половину.
      sub: m
        ? [
            attention ? `внимания требуют ${attention}` : null,
            m.tokens_expiring_7d ? `токены истекают у ${m.tokens_expiring_7d}` : null,
          ].filter(Boolean).join(" · ") || "все аккаунты в порядке"
        : "",
      tone: attention ? "bad" : m?.health_avg != null && m.health_avg < 70 ? "warn" : m?.tokens_expiring_7d ? "warn" : undefined,
      onClick: () => onOpen("accounts"),
    },
    {
      label: "Расход проекта за месяц",
      value: spend != null ? `$${spend.toFixed(2)}` : "—",
      hint: "Общий расход проекта на генерацию и публикацию из журнала usage_ledger. Месячный бюджет задаётся во вкладке «Настройки».",
      sub: [
        today != null ? `сегодня $${today.toFixed(2)}` : null,
        budget != null ? `бюджет $${budget.toFixed(0)}` : null,
      ].filter(Boolean).join(" · "),
      tone: spend != null && budget != null && budget > 0 && spend >= budget ? "bad" : undefined,
      onClick: () => onOpen("settings"),
    },
  ];

  return (
    <TooltipProvider delayDuration={200}>
      <div className="grid grid-cols-2 divide-x divide-y overflow-hidden rounded-2xl border bg-card md:grid-cols-5 md:divide-y-0">
        {cells.map((c) => (
          <Tooltip key={c.label}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={c.onClick}
                className="min-w-0 px-4 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
              >
                <div className="truncate text-xs text-muted-foreground">{c.label}</div>
                <div
                  className={cn(
                    "mt-0.5 text-xl font-semibold leading-tight tabular-nums",
                    c.tone === "bad" && "text-destructive",
                    c.tone === "warn" && "text-amber-600 dark:text-amber-400",
                  )}
                >
                  {c.value}
                </div>
                {/* Без truncate: «токены ...» в обрезанной строке не сообщал ничего. */}
                <div className="mt-0.5 min-h-[1.75rem] text-xs leading-tight text-muted-foreground">{c.sub || "\u00A0"}</div>
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">{c.hint}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
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
  auto_publish_after: string;
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
  auto_publish_after: "",
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
    auto_publish_after: g.auto_publish_after != null ? String(g.auto_publish_after) : "",
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
        per_hour: numOrNull(draft.per_hour),
        persona_id: draft.persona_id === NONE ? null : draft.persona_id,
        review_mode: draft.review_mode,
        auto_publish_after: numOrNull(draft.auto_publish_after),
        timezone: draft.timezone.trim() || null,
        window_start: draft.window_start || null,
        window_end: draft.window_end || null,
        min_gap_minutes: numOrNull(draft.min_gap_minutes),
        jitter_minutes: numOrNull(draft.jitter_minutes),
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
                {g.platform ? ` · ${PLATFORM_META[g.platform].label}` : ""}
              </div>
              {g.review_mode === "auto_publish" && (
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Одобрено подряд {g.approved_streak} из {g.auto_publish_after ?? 5} до публикации без согласования
                </div>
              )}
            </button>
          );
        })}
      </div>

      {draft ? (
        <div className="space-y-4 rounded-2xl border bg-card p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">{draft.id ? "Редактирование группы" : "Новая группа"}</h3>
            {selected && (
              <span className="text-xs text-muted-foreground">
                Одобрено подряд: {selected.approved_streak} из {selected.auto_publish_after ?? 5}
              </span>
            )}
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
            {/* Порог доверия сравнивается с approved_streak в content-pipeline:
                настройка работала, а задать её было негде. */}
            <Field label="Автопубликация после, одобрений">
              <Input
                type="number"
                min={1}
                placeholder="5"
                value={draft.auto_publish_after}
                onChange={(e) => set("auto_publish_after", e.target.value)}
              />
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

/**
 * Подпись + контрол. Label без htmlFor не связан с полем: ни скринридер, ни
 * автотест не знают, какое поле называется «Окно с». Ставим контролу
 * aria-label по подписи, если своего нет; у Radix Select имя вешаем на триггер.
 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const named = isValidElement(children) && !(children.props as { "aria-label"?: string })["aria-label"]
    ? cloneElement(children as ReactElement, { "aria-label": label } as Record<string, unknown>)
    : children;
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {named}
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

/** Что именно делает каждый режим уведомлений — иначе выбор наугад. */
const NOTIFY_HINT: Record<NotifyMode, string> = {
  digest: "Раз в час один отчёт по проекту: сколько вышло, что упало и какие аккаунты требуют внимания.",
  each: "Сообщение на каждое событие очереди: провал, ручной разбор, протухший токен. Шумно на большой сети.",
  silent: "Молчим. Провалы видно только здесь, во вкладке «Задания».",
};

function SettingsTab({ pub }: { pub: UsePublishing }) {
  const disabled = pub.busy != null;
  const s = pub.settings;
  const [notify, setNotify] = useState<NotifyMode>("digest");
  const [chat, setChat] = useState("");
  const [daily, setDaily] = useState("");
  const [monthly, setMonthly] = useState("");
  const [paused, setPaused] = useState(false);

  // Форму заполняем с сервера один раз на проект: любое действие на странице
  // перечитывает settings, и правка бюджета, ещё не сохранённая, пропадала бы.
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!s) { seededFor.current = null; return; }
    if (seededFor.current === pub.projectId) return;
    seededFor.current = pub.projectId;
    setNotify(s.settings.notify_mode);
    setChat(s.settings.digest_chat_id ?? "");
    setDaily(String(s.budget.daily_usd));
    setMonthly(String(s.budget.monthly_usd));
    setPaused(Boolean(s.settings.paused));
  }, [s, pub.projectId]);

  if (!s) return <EmptyState text="Настройки не загружены — выберите проект или обновите страницу." />;

  // Чужой формат chat id площадка молча проглотит, а дайджест потом не придёт.
  const chatValid = chat.trim() === "" || /^-?\d{5,20}$/.test(chat.trim());
  const dirty =
    notify !== s.settings.notify_mode ||
    chat.trim() !== (s.settings.digest_chat_id ?? "") ||
    daily.trim() !== String(s.budget.daily_usd) ||
    monthly.trim() !== String(s.budget.monthly_usd);

  const save = async () => {
    if (!chatValid) {
      toast.error("Telegram chat id — число, например -1001234567890");
      return;
    }
    try {
      await pub.settingsUpsert({
        notify_mode: notify,
        digest_chat_id: chat.trim() || null,
        daily_usd: numOrNull(daily),
        monthly_usd: numOrNull(monthly),
      });
      toast.success("Настройки сохранены");
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const testNotify = async () => {
    try {
      const r = await pub.notifyTest();
      toast.success(r.own_chat ? `Сообщение ушло в чат ${r.chat_id}` : `Сообщение ушло в чат проекта ${r.chat_id}`);
    } catch (e) {
      toast.error(errMsg(e, "Проверка не прошла"));
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

  const queued = pub.metrics?.publish?.jobs_queued ?? 0;
  const monthlyLimit = Number(s.budget.monthly_usd);
  const spentMonth = s.spend.month_usd;
  const overMonth = monthlyLimit > 0 && spentMonth >= monthlyLimit;
  const overDay = Number(s.budget.daily_usd) > 0 && s.spend.today_usd >= Number(s.budget.daily_usd);

  return (
    <div className="grid max-w-4xl items-start gap-4 lg:grid-cols-2">
      {/* Рубильник: единственная настройка, которая действует немедленно */}
      <section className={cn("space-y-3 rounded-2xl border p-4 lg:col-span-2", paused ? "border-amber-500/40 bg-amber-500/10" : "bg-card")}>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="text-sm font-medium">Пауза публикаций проекта</div>
            <p className="text-xs text-muted-foreground">
              Воркер перестаёт забирать задания, новые слоты не планируются. Очередь никуда не девается и поедет
              дальше, как только паузу снять.
              {queued > 0 && (paused ? ` Сейчас заморожено заданий: ${queued}.` : ` Сейчас в очереди: ${queued}.`)}
            </p>
          </div>
          <Switch checked={paused} disabled={disabled} onCheckedChange={(v) => void togglePause(v)} aria-label="Пауза публикаций проекта" />
        </div>
      </section>

      {/* Уведомления */}
      <section className="space-y-3 rounded-2xl border bg-card p-4">
        <div>
          <h3 className="text-sm font-medium">Уведомления в Telegram</h3>
          <p className="mt-1 text-xs text-muted-foreground">Кто узнаёт о провалах и выходах постов.</p>
        </div>
        <Field label="Когда писать">
          <Select value={notify} onValueChange={(v) => setNotify(v as NotifyMode)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(NOTIFY_MODE_META) as NotifyMode[]).map((m) => (
                <SelectItem key={m} value={m}>{NOTIFY_MODE_META[m].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <p className="text-xs text-muted-foreground">{NOTIFY_HINT[notify]}</p>
        <Field label="Telegram chat id">
          <Input
            value={chat}
            aria-label="Telegram chat id"
            placeholder="-1001234567890"
            aria-invalid={!chatValid}
            className={cn(!chatValid && "border-destructive")}
            onChange={(e) => setChat(e.target.value)}
          />
        </Field>
        <p className={cn("text-xs", chatValid ? "text-muted-foreground" : "text-destructive")}>
          {chatValid
            ? "Пусто — пишем в чат, привязанный к проекту в Telegram. Свой id нужен, чтобы увести отчёты в отдельную группу."
            : "Это число: id личного чата или группы (у групп со знаком минус)."}
        </p>
        {/* Настройка, которую нельзя проверить, работает только на бумаге:
            дайджест приходит раз в час, и молчание не отличить от поломки. */}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={disabled || dirty} onClick={() => void testNotify()}>
            {pub.busy === "notify_test" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
            Проверить связь
          </Button>
          {dirty && <span className="text-xs text-muted-foreground">Сначала сохраните — проверка идёт по сохранённому чату.</span>}
        </div>
      </section>

      {/* Бюджет */}
      <section className="space-y-3 rounded-2xl border bg-card p-4">
        <div>
          <h3 className="text-sm font-medium">Бюджет проекта на ИИ</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Считается по журналу расходов проекта: генерация, радар идей, конвейер. При превышении радар
            перестаёт собирать конкурентов и генерировать. Публикация уже готовых заданий не останавливается —
            для этого пауза выше. Ноль — без ограничения.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="В день, $">
            <Input type="number" min={0} step="0.01" aria-label="Бюджет в день, $" value={daily} onChange={(e) => setDaily(e.target.value)} />
          </Field>
          <Field label="В месяц, $">
            <Input type="number" min={0} step="0.01" aria-label="Бюджет в месяц, $" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
          </Field>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className={cn("text-muted-foreground", overDay && "text-destructive")}>
              Сегодня ${s.spend.today_usd.toFixed(2)}{Number(s.budget.daily_usd) > 0 ? ` из $${Number(s.budget.daily_usd).toFixed(0)}` : ""}
            </span>
            <span className={cn("text-muted-foreground", overMonth && "text-destructive")}>
              За месяц ${spentMonth.toFixed(2)}{monthlyLimit > 0 ? ` из $${monthlyLimit.toFixed(0)}` : ""}
            </span>
          </div>
          {monthlyLimit > 0 && (
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="presentation">
              <div
                className={cn("h-full rounded-full", overMonth ? "bg-destructive" : "bg-primary")}
                style={{ width: `${Math.min(100, (spentMonth / monthlyLimit) * 100)}%` }}
              />
            </div>
          )}
          {(overDay || overMonth) && (
            <p className="text-xs text-destructive">Бюджет выбран — генерация нового контента остановлена до смены лимита.</p>
          )}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3 lg:col-span-2">
        <Button onClick={() => void save()} disabled={disabled || !dirty || !chatValid}>
          {pub.busy === "settings_upsert" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Сохранить
        </Button>
        {dirty && <span className="text-xs text-muted-foreground">Есть несохранённые изменения.</span>}
      </div>
    </div>
  );
}

/* ───────────────────────────── диалоги ───────────────────────────── */


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
