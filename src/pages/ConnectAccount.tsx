/**
 * Публичная страница подключения аккаунта по ссылке — /connect/:token.
 *
 * Сюда приходит клиент, у которого нет доступа в MarkVision: менеджер прислал
 * ему ссылку в мессенджере. Клиент видит, какому проекту он даёт доступ, жмёт
 * кнопку своей площадки, проходит обычный вход (Instagram → Facebook, TikTok,
 * YouTube, Threads) и возвращается сюда же на экран «Готово».
 *
 * Страница без авторизации и без сайдбара: всё общение с сервером — публичные
 * маршруты publish-oauth/invite, доверие которым даёт токен из адреса.
 *
 * Три состояния возврата с площадки (?publish_… в адресе):
 *   publish_connected — аккаунт подключён;
 *   publish_select    — у клиента несколько страниц Facebook, нужен выбор;
 *   publish_error     — площадка отказала, показываем текст и даём повторить.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { AlertCircle, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  connectInvitePages,
  fetchConnectInvite,
  finishConnectInvite,
  formatFollowers,
  PLATFORM_META,
  startConnectInvite,
  INSTAGRAM_MODE_META,
  type ConnectInvite,
  type ConnectInvitePage,
  type ConnectLinkAccount,
  type InstagramConnectMode,
  type PublishPlatform,
} from "@/lib/publishingClient";
import { ConnectBlockedHelp, ConnectQrCard } from "@/components/publishing/ConnectHelp";
import { cn } from "@/lib/utils";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Не удалось выполнить действие";
}

/** Что клиент отдаёт проекту — пишем прямым текстом, без юридического тумана. */
const PLATFORM_PROMISE: Record<PublishPlatform, string> = {
  instagram: "публикация Reels и постов, чтение статистики",
  tiktok: "загрузка видео и чтение статистики",
  youtube: "загрузка видео и чтение статистики канала",
  threads: "публикация постов",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10">
      <div className="w-full max-w-lg space-y-4">{children}</div>
    </div>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-2xl border bg-card p-5 shadow-sm", className)}>{children}</div>;
}

export default function ConnectAccount() {
  const { token = "" } = useParams<{ token: string }>();
  const [params, setParams] = useSearchParams();
  const [invite, setInvite] = useState<ConnectInvite | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Ключ занятой кнопки: у Instagram их две — «platform:mode».
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ platform: string; account: string | null } | null>(null);

  // Выбор страницы Instagram, когда у клиента их несколько.
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pages, setPages] = useState<ConnectInvitePage[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setInvite(await fetchConnectInvite(token));
      setLoadError(null);
    } catch (e) {
      setLoadError(errMsg(e));
    }
  }, [token]);

  useEffect(() => { if (token) void load(); }, [token, load]);

  // Возврат с площадки: результат приезжает параметрами адреса, читаем и стираем.
  useEffect(() => {
    const connected = params.get("publish_connected");
    const select = params.get("publish_select");
    const err = params.get("publish_error");
    if (!connected && !select && !err) return;
    if (connected) setDone({ platform: connected, account: params.get("account") });
    if (err) setError(err);
    if (select) setPendingId(select);
    setParams(new URLSearchParams(), { replace: true });
  }, [params, setParams]);

  // Список страниц подтягиваем отдельно: в адресе едет только идентификатор выбора.
  useEffect(() => {
    if (!pendingId) return;
    connectInvitePages(token, pendingId)
      .then((list) => {
        const usable = list.filter((p) => p.connectable);
        setPages(usable);
        if (usable.length === 1) setPicked(new Set([usable[0].page_id]));
      })
      .catch((e) => { setError(errMsg(e)); setPendingId(null); });
  }, [pendingId, token]);

  const connect = async (platform: PublishPlatform, mode?: InstagramConnectMode) => {
    setBusy(mode ? `${platform}:${mode}` : platform);
    setError(null);
    try {
      window.location.assign(await startConnectInvite(token, platform, mode));
    } catch (e) {
      setError(errMsg(e));
      setBusy(null);
    }
  };

  const savePages = async () => {
    if (!pendingId || !picked.size) return;
    setSaving(true);
    setError(null);
    try {
      const connected: ConnectLinkAccount[] = await finishConnectInvite(token, pendingId, [...picked]);
      setPendingId(null);
      setPages(null);
      setDone({ platform: "instagram", account: connected.map((a) => a.account_name).join(", ") || null });
      void load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  if (!token || loadError) {
    return (
      <Shell>
        <Card className="text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-destructive" />
          <h1 className="mt-3 text-lg font-semibold">Ссылка не работает</h1>
          <p className="mt-1 text-sm text-muted-foreground">{loadError ?? "Адрес неполный."}</p>
        </Card>
      </Shell>
    );
  }

  if (!invite) {
    return (
      <Shell>
        <Card className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </Card>
      </Shell>
    );
  }

  const inactive = invite.state !== "active";

  return (
    <Shell>
      <Card>
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2"><ShieldCheck className="h-5 w-5 text-primary" /></div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold leading-tight">Подключение аккаунта</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {invite.project_name ? <>Проект <span className="font-medium text-foreground">{invite.project_name}</span> просит доступ на публикацию.</> : "Проект просит доступ на публикацию."}
            </p>
          </div>
        </div>
        {invite.note && <p className="mt-3 rounded-xl bg-muted/60 px-3 py-2 text-sm">{invite.note}</p>}
      </Card>

      {done && (
        <Card className="border-emerald-500/40 bg-emerald-500/5">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <div>
              <div className="font-medium">Успешно подключено</div>
              <p className="text-sm text-muted-foreground">
                {done.account ? `${done.account} — аккаунт уже виден в проекте.` : "Аккаунт уже виден в проекте."} Окно можно закрыть.
              </p>
            </div>
          </div>
        </Card>
      )}

      {error && (
        <Card className="border-destructive/40 bg-destructive/5">
          <div className="flex items-start gap-3 text-sm">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <span>{error}</span>
          </div>
        </Card>
      )}

      {inactive && (
        <Card className="border-amber-500/40 bg-amber-500/5 text-sm">{invite.state_text}</Card>
      )}

      {/* Вход с компьютера площадки режут как подозрительный — уводим на телефон. */}
      {!pages && !done && !inactive && <ConnectQrCard url={`${window.location.origin}/connect/${token}`} />}

      {/* Выбор страницы: показываем вместо кнопок, чтобы клиент не потерялся. */}
      {pages ? (
        <Card>
          <h2 className="text-sm font-semibold">Какой аккаунт подключить?</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            К вашему Facebook привязано несколько Instagram-аккаунтов. Отметьте те, которыми будет заниматься проект.
          </p>
          <div className="mt-3 space-y-1.5">
            {pages.map((p) => (
              <label key={p.page_id} className="flex cursor-pointer items-center gap-3 rounded-xl border p-2.5 hover:bg-muted/50">
                <Checkbox
                  checked={picked.has(p.page_id)}
                  onCheckedChange={(v) => setPicked((prev) => {
                    const next = new Set(prev);
                    if (v) next.add(p.page_id); else next.delete(p.page_id);
                    return next;
                  })}
                />
                {p.ig_avatar_url
                  ? <img src={p.ig_avatar_url} alt="" className="h-9 w-9 rounded-full object-cover" />
                  : <div className="h-9 w-9 rounded-full bg-muted" />}
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{p.ig_name ?? p.ig_username ?? p.page_name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {p.ig_username ? `@${p.ig_username}` : p.page_name}
                    {p.ig_followers != null && ` · ${formatFollowers(p.ig_followers)}`}
                  </div>
                </div>
              </label>
            ))}
          </div>
          <Button className="mt-3 w-full" disabled={!picked.size || saving} onClick={() => void savePages()}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Подключить {picked.size > 1 ? `${picked.size} аккаунта` : "аккаунт"}
          </Button>
        </Card>
      ) : (
        <Card>
          <h2 className="text-sm font-semibold">Выберите площадку</h2>
          <div className="mt-3 space-y-2">
            {invite.platforms.flatMap(({ platform, ready, hint, modes }) => {
              const meta = PLATFORM_META[platform];
              // У Instagram два входа, и клиенту важна разница: логином
              // Instagram (страница Facebook не нужна) или через Facebook.
              const doors = platform === "instagram" && modes?.length
                ? modes.map((m) => ({
                  key: `${platform}:${m.mode}`,
                  mode: m.mode as InstagramConnectMode | undefined,
                  ready: m.ready,
                  hint: m.hint,
                  title: INSTAGRAM_MODE_META[m.mode].title,
                  subtitle: INSTAGRAM_MODE_META[m.mode].description,
                }))
                : [{ key: platform, mode: undefined, ready, hint, title: `Подключить ${meta.label}`, subtitle: PLATFORM_PROMISE[platform] }];
              return doors.map((door) => (
                <div key={door.key}>
                  <Button
                    variant="outline"
                    className="h-auto w-full justify-start gap-3 py-3"
                    disabled={inactive || !door.ready || busy != null}
                    onClick={() => void connect(platform, door.mode)}
                  >
                    {busy === door.key
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Badge variant="outline" className={cn("border-transparent", meta.cls)}>{meta.label}</Badge>}
                    <span className="min-w-0 text-left">
                      <span className="block whitespace-normal text-sm font-medium">{door.title}</span>
                      <span className="block whitespace-normal text-xs font-normal text-muted-foreground">{door.subtitle}</span>
                    </span>
                  </Button>
                  {!door.ready && door.hint && <p className="mt-1 px-1 text-xs text-muted-foreground">Пока недоступно: {door.hint}</p>}
                </div>
              ));
            })}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Пароль вы вводите только на сайте самой площадки — мы его не видим. Доступ можно отозвать в настройках вашего аккаунта в любой момент.
          </p>
        </Card>
      )}

      {!pages && !done && <ConnectBlockedHelp />}


      {invite.connected.length > 0 && (
        <Card>
          <h2 className="text-sm font-semibold">Уже подключено по этой ссылке</h2>
          <ul className="mt-2 space-y-1.5">
            {invite.connected.map((a) => (
              <li key={`${a.platform}-${a.account_name}`} className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                <span className="truncate">{a.account_name}</span>
                {a.handle && <span className="truncate text-xs text-muted-foreground">@{a.handle}</span>}
                <Badge variant="outline" className={cn("ml-auto border-transparent text-[10px]", PLATFORM_META[a.platform as PublishPlatform]?.cls)}>
                  {PLATFORM_META[a.platform as PublishPlatform]?.label ?? a.platform}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Shell>
  );
}
