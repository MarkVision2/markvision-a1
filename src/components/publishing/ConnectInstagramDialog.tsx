/**
 * Подключение Instagram — три двери в одном окне.
 *
 * 1. «Подключить аккаунт Instagram» — вход логином самого Instagram
 *    (Instagram API with Instagram Login). Facebook-страница не нужна, аккаунт
 *    должен быть профессиональным; подключается один аккаунт за вход.
 * 2. «Подключить аккаунт Instagram через Facebook» — вход в Facebook, после
 *    возврата показываем его страницы с привязанным Instagram и подключаем
 *    отмеченные пачкой.
 * 3. «Из Meta-токена проекта» — без нового входа: страницы токена, который уже
 *    сохранён в настройках проекта. Быстрый путь для своих аккаунтов.
 *
 * Второй и третий путь заканчиваются одним и тем же экраном выбора: список
 * аккаунтов с поиском, фильтрами по состоянию и пресетом на всю пачку
 * (группа, персона, рутина, пояс, окно, лимит, разгон) — сотню аккаунтов
 * после подключения не настраивают по одному.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Check, ChevronRight, Facebook, Instagram, KeyRound, Loader2, Plus, Search, Users } from "lucide-react";
import { toast } from "sonner";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { UsePublishing } from "@/hooks/usePublishing";
import {
  DEFAULT_TIMEZONE,
  fetchPendingPages,
  finishPendingPages,
  formatFollowers,
  INSTAGRAM_MODE_META,
  publishingApi,
  startInstagramConnect,
  type AccountUpdateInput,
  type AvailablePage,
  type InstagramConnectMode,
} from "@/lib/publishingClient";
import { cn } from "@/lib/utils";

/** Radix Select не принимает пустое значение — сентинел для «не выбрано». */
const NONE = "__none";

function errMsg(e: unknown, fallback = "Ошибка"): string {
  return e instanceof Error ? e.message : fallback;
}

function initials(s: string): string {
  return s.replace(/^@/, "").slice(0, 2).toUpperCase();
}

/** Откуда взялся список аккаунтов на экране выбора. */
type PickSource =
  | { kind: "project" }
  | { kind: "pending"; pendingId: string };

type Filter = "connectable" | "connected" | "none";
type Sort = "followers" | "name";

export interface ConnectInstagramDialogProps {
  open: boolean;
  onClose: () => void;
  pub: UsePublishing;
  /**
   * Возврат со входа через Facebook: id отложенного выбора страниц
   * (?publish_select=…). Окно сразу открывается на экране выбора.
   */
  pendingId?: string | null;
}

export function ConnectInstagramDialog({ open, onClose, pub, pendingId }: ConnectInstagramDialogProps) {
  const [source, setSource] = useState<PickSource | null>(null);
  const [redirecting, setRedirecting] = useState<InstagramConnectMode | null>(null);

  const [pages, setPages] = useState<AvailablePage[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("connectable");
  const [sort, setSort] = useState<Sort>("followers");
  const [picked, setPicked] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const [groupId, setGroupId] = useState<string>(NONE);
  const [presetOpen, setPresetOpen] = useState(false);
  const [personaId, setPersonaId] = useState<string>(NONE);
  const [routineId, setRoutineId] = useState<string>(NONE);
  const [routines, setRoutines] = useState<{ id: string; name: string }[]>([]);
  const [dailyLimit, setDailyLimit] = useState("");
  const [timezone, setTimezone] = useState("");
  const [windowStart, setWindowStart] = useState("");
  const [windowEnd, setWindowEnd] = useState("");
  const [ramp, setRamp] = useState(false);

  // Запасной путь: сохранённый Meta-токен проекта площадка отклонила —
  // человек вставляет свежий User Access Token только для этого подключения.
  const [manualToken, setManualToken] = useState("");
  const [usedToken, setUsedToken] = useState<string | null>(null);

  const busy = saving || pub.busy != null;

  useEffect(() => {
    if (!open) return;
    setPages(null);
    setPicked([]);
    setErr(null);
    setQuery("");
    setFilter("connectable");
    setSort("followers");
    setManualToken("");
    setUsedToken(null);
    setGroupId(NONE);
    setPresetOpen(false);
    setPersonaId(NONE);
    setRoutineId(NONE);
    setDailyLimit("");
    setTimezone("");
    setWindowStart("");
    setWindowEnd("");
    setRamp(false);
    setRedirecting(null);
    setSource(pendingId ? { kind: "pending", pendingId } : null);
    if (pub.projectId) {
      publishingApi.routineList(pub.projectId)
        .then((r) => setRoutines((r.routines ?? []).map((x) => ({ id: x.id, name: x.name }))))
        .catch(() => setRoutines([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pendingId]);

  /** Список аккаунтов под выбранный источник. */
  const loadPages = (src: PickSource, metaToken?: string | null) => {
    setPages(null);
    setPicked([]);
    setErr(null);
    if (src.kind === "project") {
      pub.loadAvailable(metaToken)
        .then((r) => { setPages(r.pages ?? []); setUsedToken(metaToken ?? null); })
        .catch((e) => { setPages([]); setErr(errMsg(e, "Не удалось получить страницы Meta")); });
      return;
    }
    if (!pub.projectId) return;
    fetchPendingPages(pub.projectId, src.pendingId)
      .then((r) => {
        setPages(r.pages);
        if (r.group_id) setGroupId(r.group_id);
        // После входа человек уже выбрал аккаунты в самом Facebook — отмечаем
        // всё пригодное, чтобы не заставлять кликать второй раз.
        setPicked(r.pages.filter((p) => p.connectable && !p.already_connected).map((p) => p.page_id));
      })
      .catch((e) => { setPages([]); setErr(errMsg(e, "Выбор устарел — начните подключение заново")); });
  };

  useEffect(() => {
    if (!open || !source) return;
    loadPages(source);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, source?.kind, source?.kind === "pending" ? source.pendingId : null]);

  /** Вход на площадку: уводим человека из приложения, окно закроется само. */
  const goToPlatform = async (mode: InstagramConnectMode) => {
    if (!pub.projectId) return;
    setRedirecting(mode);
    setErr(null);
    try {
      const url = await startInstagramConnect(pub.projectId, mode, groupId === NONE ? null : groupId);
      window.location.assign(url);
    } catch (e) {
      setErr(errMsg(e, "Не удалось начать подключение"));
      setRedirecting(null);
    }
  };

  /** Пресет из формы; пустые поля не отправляем — сервер трактует их как «не менять». */
  const buildPreset = (): { ok: true; preset: AccountUpdateInput } | { ok: false; error: string } => {
    const preset: AccountUpdateInput = {};
    if (personaId !== NONE) preset.persona_id = personaId;
    if (routineId !== NONE) preset.routine_id = routineId;
    if (dailyLimit.trim()) {
      const v = Number(dailyLimit);
      if (!Number.isInteger(v) || v < 1 || v > 200) return { ok: false, error: "Лимит — целое число от 1 до 200" };
      preset.daily_limit = v;
    }
    if (timezone.trim()) preset.timezone = timezone.trim();
    if ((windowStart && !windowEnd) || (!windowStart && windowEnd)) return { ok: false, error: "Окно публикаций — оба времени: с и до" };
    if (windowStart && windowEnd) { preset.window_start = windowStart; preset.window_end = windowEnd; }
    if (ramp) preset.ramp_enabled = true;
    return { ok: true, preset };
  };

  const all = pages ?? [];
  const connectable = useMemo(() => all.filter((p) => p.connectable && !p.already_connected), [all]);
  const connected = useMemo(() => all.filter((p) => p.already_connected), [all]);
  const noInstagram = useMemo(() => all.filter((p) => !p.connectable), [all]);

  const q = query.trim().toLowerCase();
  const bucket = filter === "connectable" ? connectable : filter === "connected" ? connected : noInstagram;
  const visible = useMemo(() => {
    const matched = bucket.filter((p) => !q || [p.ig_username, p.ig_name, p.page_name].some((v) => v?.toLowerCase().includes(q)));
    return [...matched].sort((a, b) => sort === "followers"
      ? (b.ig_followers ?? -1) - (a.ig_followers ?? -1)
      : (a.ig_username ?? a.page_name ?? "").localeCompare(b.ig_username ?? b.page_name ?? "", "ru"));
  }, [bucket, q, sort]);

  const allVisiblePicked = visible.length > 0 && visible.every((p) => picked.includes(p.page_id));
  const pickedFollowers = useMemo(
    () => connectable.filter((p) => picked.includes(p.page_id)).reduce((sum, p) => sum + (p.ig_followers ?? 0), 0),
    [connectable, picked],
  );

  const toggle = (id: string) => setPicked((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const toggleAll = () => {
    if (allVisiblePicked) setPicked((s) => s.filter((id) => !visible.some((p) => p.page_id === id)));
    else setPicked((s) => Array.from(new Set([...s, ...visible.map((p) => p.page_id)])));
  };

  const submit = async () => {
    if (!picked.length || !source || !pub.projectId) return;
    const built = buildPreset();
    if (built.ok === false) { setErr(built.error); return; }
    const preset = Object.keys(built.preset).length ? built.preset : null;
    const group = groupId === NONE ? null : groupId;
    setSaving(true);
    setErr(null);
    try {
      const r = source.kind === "project"
        ? await pub.connect(picked, usedToken, group, preset)
        : await finishPendingPages(pub.projectId, source.pendingId, picked, group);

      const count = r.connected?.length ?? 0;
      // Вход через Facebook подключает страницы своим маршрутом — пресет
      // применяем следом одной массовой правкой.
      if (source.kind === "pending" && preset && count) {
        try {
          await pub.bulkUpdateAccounts(r.connected.map((a) => a.id), preset);
        } catch (e) {
          toast.warning(`Подключено, но пресет не применился: ${errMsg(e)}`);
        }
      }
      if ("preset_error" in r && r.preset_error) toast.warning(`Подключено, но пресет не применился: ${r.preset_error}`);
      if (r.skipped?.length) {
        // Причину пропуска называем — «пропущено: 2» ничего не объясняет.
        const names = new Map(all.map((p) => [p.page_id, p.ig_username ? `@${p.ig_username}` : p.page_name ?? p.page_id]));
        const detail = r.skipped.slice(0, 3).map((x) => `${names.get(x.page_id) ?? x.page_id}: ${x.reason}`).join("; ");
        toast.warning(`Подключено ${count}, пропущено ${r.skipped.length} — ${detail}${r.skipped.length > 3 ? " …" : ""}`);
      } else {
        toast.success(`Подключено: ${count}`);
      }
      if (source.kind === "pending" && count) await pub.refetch();
      if (count) onClose();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-pink-500 via-rose-500 to-amber-400 text-white shadow-sm">
              <Instagram className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <DialogTitle>{source ? "Выберите аккаунты" : "Подключение Instagram"}</DialogTitle>
              <DialogDescription>
                {!source
                  ? "Выберите способ входа. Пароль вводится только на сайте площадки — мы его не видим."
                  : source.kind === "pending"
                  ? "Аккаунты Instagram, привязанные к страницам вашего Facebook."
                  : "Страницы Meta-токена проекта с привязанным Instagram Business или Creator."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {err && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{err}</div>}

        {!source && (
          <MethodList
            redirecting={redirecting}
            disabled={busy || !pub.projectId}
            onMode={(m) => void goToPlatform(m)}
            onProject={() => setSource({ kind: "project" })}
          />
        )}

        {source && (
          <div className="space-y-3">
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => { setSource(null); setPages(null); setPicked([]); setErr(null); }}
            >
              <ArrowLeft className="h-3.5 w-3.5" /> другой способ подключения
            </button>

            {/* Токен проекта площадка отклонила — даём вставить свежий. */}
            {err && source.kind === "project" && (
              <div className="space-y-2 rounded-xl border p-3 text-sm">
                <div className="font-medium">Что делать</div>
                <p className="text-xs text-muted-foreground">
                  Подключите Facebook заново в{" "}
                  <Link to="/settings" className="underline" onClick={onClose}>Настройках → Meta</Link>,
                  войдите через Facebook на прошлом экране или вставьте User Access Token (Graph API Explorer) —
                  он будет использован только для этого подключения.
                </p>
                <div className="flex gap-2">
                  <Input aria-label="User Access Token" placeholder="EAAB…" value={manualToken} onChange={(e) => setManualToken(e.target.value)} />
                  <Button variant="outline" disabled={busy || !manualToken.trim()} onClick={() => loadPages(source, manualToken.trim())}>
                    Проверить
                  </Button>
                </div>
              </div>
            )}

            {pages == null && !err && <RowsSkeleton />}

            {pages != null && !err && (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  <FilterChip active={filter === "connectable"} onClick={() => setFilter("connectable")} label="Доступные" count={connectable.length} />
                  <FilterChip active={filter === "connected"} onClick={() => setFilter("connected")} label="Подключены" count={connected.length} />
                  <FilterChip active={filter === "none"} onClick={() => setFilter("none")} label="Без Instagram" count={noInstagram.length} />
                  <div className="ml-auto">
                    <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
                      <SelectTrigger className="h-8 w-[168px]" aria-label="Порядок списка"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="followers">Сначала крупные</SelectItem>
                        <SelectItem value="name">По алфавиту</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {bucket.length > 6 && (
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      aria-label="Поиск аккаунтов"
                      className="pl-9"
                      placeholder="Поиск по @имени или названию страницы"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                )}

                {filter === "connectable" && connectable.length > 0 && (
                  <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
                    <span>Выбрано <b className="text-foreground">{picked.length}</b> из {connectable.length}</span>
                    <button type="button" className="underline-offset-2 hover:underline" onClick={toggleAll} disabled={!visible.length}>
                      {allVisiblePicked ? "Снять выбор" : q ? `Выбрать найденные (${visible.length})` : "Выбрать все"}
                    </button>
                  </div>
                )}

                {visible.length > 0 ? (
                  <ScrollArea className="max-h-[42vh] rounded-xl border">
                    <div className="space-y-0.5 p-1.5">
                      {visible.map((p) => (
                        <PageRow
                          key={p.page_id}
                          page={p}
                          state={filter === "connectable" ? "pick" : filter === "connected" ? "connected" : "none"}
                          picked={picked.includes(p.page_id)}
                          onToggle={() => toggle(p.page_id)}
                        />
                      ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                    {q
                      ? `Ничего не найдено по «${query}»`
                      : filter === "connectable"
                      ? (connected.length ? "Все доступные Instagram-аккаунты уже подключены." : "Нет страниц с привязанным Instagram Business или Creator.")
                      : filter === "connected"
                      ? "Из этого списка пока ничего не подключено."
                      : "Все страницы связаны с Instagram."}
                  </div>
                )}

                {connectable.length > 0 && (
                  <div className="space-y-2 rounded-xl border bg-muted/30 px-3 py-2">
                    {pub.groups.length > 0 && (
                      <div className="flex items-center gap-3">
                        <Label className="shrink-0 text-xs text-muted-foreground">Сразу в группу</Label>
                        <Select value={groupId} onValueChange={setGroupId} disabled={busy}>
                          <SelectTrigger className="h-8" aria-label="Группа для новых аккаунтов"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>Без группы</SelectItem>
                            {pub.groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <button
                      type="button"
                      className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                      aria-expanded={presetOpen}
                      onClick={() => setPresetOpen((v) => !v)}
                    >
                      {presetOpen ? "Скрыть" : "Настроить"} пачку сразу: персона, рутина, пояс, окно, лимит, разгон
                    </button>
                    {presetOpen && (
                      <div className="grid gap-2 sm:grid-cols-2" aria-label="Пресет онбординга">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Персона</Label>
                          <Select value={personaId} onValueChange={setPersonaId} disabled={busy}>
                            <SelectTrigger className="h-8" aria-label="Персона для новых аккаунтов"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>Без персоны</SelectItem>
                              {pub.personas.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Рутина</Label>
                          <Select value={routineId} onValueChange={setRoutineId} disabled={busy}>
                            <SelectTrigger className="h-8" aria-label="Рутина для новых аккаунтов"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>По умолчанию</SelectItem>
                              {routines.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Лимит в день</Label>
                          <Input className="h-8" type="number" min={1} max={200} placeholder="как у аккаунта" aria-label="Лимит в день для новых аккаунтов" value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} disabled={busy} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Часовой пояс</Label>
                          <Input className="h-8" placeholder={DEFAULT_TIMEZONE} aria-label="Часовой пояс для новых аккаунтов" value={timezone} onChange={(e) => setTimezone(e.target.value)} disabled={busy} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Окно публикаций</Label>
                          <div className="flex items-center gap-1">
                            <Input className="h-8" type="time" aria-label="Окно с" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} disabled={busy} />
                            <span className="text-xs text-muted-foreground">—</span>
                            <Input className="h-8" type="time" aria-label="Окно до" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} disabled={busy} />
                          </div>
                        </div>
                        <div className="flex items-center gap-2 pt-5">
                          <Switch checked={ramp} onCheckedChange={setRamp} disabled={busy} aria-label="Разгон новых аккаунтов" />
                          <Label className="text-xs text-muted-foreground">Разгон (плавный рост лимита)</Label>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <DialogFooter className="items-center gap-2 sm:justify-between sm:gap-0">
          {source && picked.length > 0 ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              {picked.length} {picked.length === 1 ? "аккаунт" : "аккаунта"}
              {pickedFollowers > 0 && <> · {formatFollowers(pickedFollowers)} подписчиков</>}
            </span>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={saving}>Отмена</Button>
            {source && (
              <Button onClick={() => void submit()} disabled={busy || !picked.length}>
                {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}
                {picked.length ? `Подключить ${picked.length}` : "Подключить"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────── способы подключения ───────────────────────── */

function MethodList({
  redirecting,
  disabled,
  onMode,
  onProject,
}: {
  redirecting: InstagramConnectMode | null;
  disabled: boolean;
  onMode: (mode: InstagramConnectMode) => void;
  onProject: () => void;
}) {
  return (
    <div className="space-y-2">
      <MethodCard
        icon={<Instagram className="h-5 w-5" />}
        iconCls="bg-gradient-to-br from-pink-500 via-rose-500 to-amber-400 text-white"
        title={INSTAGRAM_MODE_META.instagram.title}
        description={INSTAGRAM_MODE_META.instagram.description}
        action={redirecting === "instagram" ? "…" : "Подключить"}
        busy={redirecting === "instagram"}
        disabled={disabled || redirecting != null}
        onClick={() => onMode("instagram")}
      />
      <MethodCard
        icon={<Facebook className="h-5 w-5" />}
        iconCls="bg-[#1877F2] text-white"
        title={INSTAGRAM_MODE_META.facebook.title}
        description={INSTAGRAM_MODE_META.facebook.description}
        action={redirecting === "facebook" ? "…" : "Подключить"}
        busy={redirecting === "facebook"}
        disabled={disabled || redirecting != null}
        onClick={() => onMode("facebook")}
      />
      <MethodCard
        icon={<KeyRound className="h-5 w-5" />}
        iconCls="bg-muted text-foreground"
        title="Из Meta-токена проекта"
        description="Без нового входа: страницы токена, сохранённого в настройках проекта. Быстрый путь для аккаунтов, доступ к которым уже есть."
        action="Открыть список"
        busy={false}
        disabled={disabled || redirecting != null}
        onClick={onProject}
      />
    </div>
  );
}

function MethodCard({
  icon, iconCls, title, description, action, busy, disabled, onClick,
}: {
  icon: React.ReactNode;
  iconCls: string;
  title: string;
  description: string;
  action: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors",
        "hover:border-primary/40 hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60",
      )}
    >
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-sm", iconCls)}>
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary">
        {action}
        <ChevronRight className="h-3.5 w-3.5" />
      </span>
    </button>
  );
}

/* ───────────────────────── список аккаунтов ───────────────────────── */

function FilterChip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
        active ? "border-primary/50 bg-primary/10 font-medium text-foreground" : "border-border text-muted-foreground hover:bg-muted/60",
      )}
    >
      {active && <Check className="h-3 w-3" />}
      {label}
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}

function PageAvatar({ page }: { page: AvailablePage }) {
  // Meta иногда не отдаёт имя страницы — не падаем на initials(null).
  const label = page.ig_username ?? page.ig_name ?? page.page_name ?? "?";
  return (
    <Avatar className="h-9 w-9 shrink-0 ring-1 ring-border">
      {page.ig_avatar_url && <AvatarImage src={page.ig_avatar_url} alt="" />}
      <AvatarFallback className="bg-gradient-to-br from-pink-500/20 to-amber-500/20 text-xs font-semibold">{initials(label)}</AvatarFallback>
    </Avatar>
  );
}

function PageRow({
  page, state, picked, onToggle,
}: {
  page: AvailablePage;
  state: "pick" | "connected" | "none";
  picked: boolean;
  onToggle: () => void;
}) {
  const inner = (
    <>
      <PageAvatar page={page} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">
            {page.ig_username ? `@${page.ig_username}` : page.ig_name ?? page.page_name ?? "Страница без имени"}
          </span>
          {page.ig_followers != null && page.ig_followers > 0 && (
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatFollowers(page.ig_followers)}</span>
          )}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {page.page_name}{page.ig_name && page.ig_username ? ` · ${page.ig_name}` : ""}
        </div>
        {page.connected_elsewhere && (
          // Один Instagram в двух проектах — двойной дневной лимит на один аккаунт площадки.
          <div className="truncate text-xs text-amber-600 dark:text-amber-400">
            уже подключён в проекте «{page.connected_elsewhere}» — лимиты сложатся
          </div>
        )}
      </div>
      {state === "pick" && <Checkbox checked={picked} tabIndex={-1} aria-hidden className="pointer-events-none" />}
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
      aria-checked={picked}
      aria-label={page.ig_username ? `@${page.ig_username}` : page.page_name ?? page.page_id}
      onClick={onToggle}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors",
        picked ? "border-primary/50 bg-primary/5" : "border-transparent hover:bg-muted/60",
      )}
    >
      {inner}
    </button>
  );
}

function RowsSkeleton() {
  return (
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
  );
}

export default ConnectInstagramDialog;
