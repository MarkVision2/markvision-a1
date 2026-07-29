import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Instagram, RefreshCw, Loader2, AlertCircle, Unplug, CheckCircle2, KeyRound, Facebook } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useInstagramAccount, type AvailableIgAccount } from "@/hooks/useInstagramAccount";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { supabase } from "@/integrations/supabase/client";

const fmtNum = (n: number) => Math.round(n).toLocaleString("ru-RU");

export function InstagramAccountConnect() {
  const { activeId: projectId } = useProjectsStore();
  const {
    account,
    loading,
    loadError,
    listAvailable,
    connect,
    connectWithLoginToken,
    disconnect,
    sync,
    setLoginToken,
  } = useInstagramAccount();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [available, setAvailable] = useState<AvailableIgAccount[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [listing, setListing] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);

  const [metaToken, setMetaToken] = useState("");
  const [hasSavedMetaToken, setHasSavedMetaToken] = useState(false);
  const [checkingMeta, setCheckingMeta] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);

  const [loginToken, setLoginTokenInput] = useState("");
  const [savingLogin, setSavingLogin] = useState(false);
  const [showLoginAlt, setShowLoginAlt] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!projectId) {
        setHasSavedMetaToken(false);
        return;
      }
      setCheckingMeta(true);
      const { data } = await supabase
        .from("meta_tokens" as never)
        .select("id")
        .eq("project_id", projectId)
        .eq("is_active", true)
        .limit(1);
      if (!cancelled) {
        setHasSavedMetaToken(((data as unknown[]) ?? []).length > 0);
        setCheckingMeta(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const saveMetaTokenIfNeeded = async (): Promise<string | undefined> => {
    const pasted = metaToken.trim();
    if (!pasted) return undefined;
    if (!projectId) throw new Error("Выберите проект");
    setSavingMeta(true);
    try {
      const { error } = await supabase.from("meta_tokens" as never).insert({
        project_id: projectId,
        label: "Instagram / Meta",
        access_token: pasted,
        is_active: true,
      } as never);
      if (error) {
        // If insert fails (e.g. not admin), still use token for this session via body.
        console.warn("[ig-connect] meta_tokens insert:", error.message);
      } else {
        setHasSavedMetaToken(true);
        toast.success("Meta-токен сохранён в проекте");
      }
      return pasted;
    } finally {
      setSavingMeta(false);
    }
  };

  const openMetaDialog = async () => {
    setDialogOpen(true);
    setListing(true);
    setListError(null);
    try {
      const sessionToken = await saveMetaTokenIfNeeded();
      const { accounts, error } = await listAvailable(sessionToken);
      setAvailable(accounts);
      if (error) setListError(error);
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Не удалось получить список");
    } finally {
      setListing(false);
    }
  };

  const handleConnect = async (acc: AvailableIgAccount) => {
    setConnecting(acc.ig_user_id);
    try {
      const sessionToken = metaToken.trim() || undefined;
      const { webhookSubscribed, webhookError } = await connect(acc, sessionToken);
      toast.success(`Подключён @${acc.username}`);
      if (!webhookSubscribed) {
        toast.warning(
          `Аккаунт подключён, но автоответ пока может быть неактивен: ${webhookError ?? "проверьте права токена"}.`,
        );
      }
      setDialogOpen(false);
      setMetaToken("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка подключения");
    } finally {
      setConnecting(null);
    }
  };

  const handleConnectWithLoginToken = async () => {
    if (!loginToken.trim()) return;
    setSavingLogin(true);
    try {
      const { username } = await connectWithLoginToken(loginToken.trim());
      setLoginTokenInput("");
      toast.success(username ? `Подключён @${username}` : "Instagram подключён");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось подключить Instagram");
    } finally {
      setSavingLogin(false);
    }
  };

  const handleSaveLoginToken = async () => {
    if (!loginToken.trim()) return;
    setSavingLogin(true);
    try {
      try {
        await setLoginToken(loginToken.trim());
        setLoginTokenInput("");
        toast.success("Instagram Login токен сохранён — DM пойдут через него");
      } catch {
        const { username } = await connectWithLoginToken(loginToken.trim());
        setLoginTokenInput("");
        toast.success(username ? `Переподключён @${username}` : "Токен сохранён");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить токен");
    } finally {
      setSavingLogin(false);
    }
  };

  const handleSync = async () => {
    try {
      const res = (await sync()) as { results?: Array<{ webhook?: { attempted?: boolean; ok?: boolean; error?: string } }> } | void;
      toast.success("Синхронизация запущена");
      const results = res && typeof res === "object" && Array.isArray(res.results) ? res.results : [];
      const wh = results[0]?.webhook;
      if (wh?.attempted && wh.ok === false) {
        toast.warning(`Автоответ на комментарии: вебхук не подписан — ${wh.error ?? "проверьте Page-токен"}`);
      } else if (wh?.attempted && wh.ok) {
        toast.message("Вебхук comments/messages активен — код-слова снова слушают комментарии");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Отключить Instagram аккаунт? Метрики останутся, но новые перестанут собираться.")) return;
    await disconnect();
    toast.success("Отключено");
  };

  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-5">
      <div className="mb-4 flex items-center gap-2">
        <Instagram className="h-5 w-5 text-pink-500" />
        <h3 className="text-sm font-bold uppercase tracking-wider">Аккаунт Instagram</h3>
      </div>

      {loadError && (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>Не удалось прочитать связку: {loadError}</span>
        </div>
      )}

      {!account ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Подключите Instagram Business через Meta User Access Token (EAAG…). Токен берётся из
            Настройки → Meta или вставляется прямо здесь.
          </p>

          <div className="rounded-xl border border-pink-500/30 bg-pink-500/5 p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <KeyRound className="h-4 w-4 text-pink-500" />
              Подключить через Meta-токен
              {checkingMeta ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              ) : hasSavedMetaToken ? (
                <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">
                  токен в проекте есть
                </span>
              ) : (
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                  токен не найден
                </span>
              )}
            </div>

            {!hasSavedMetaToken && (
              <div className="space-y-1.5">
                <Label className="text-xs">Meta User Access Token</Label>
                <Input
                  type="password"
                  value={metaToken}
                  onChange={(e) => setMetaToken(e.target.value)}
                  placeholder="EAAG…"
                  className="font-mono text-xs"
                  autoComplete="off"
                />
                <p className="text-[11px] text-muted-foreground">
                  Meta for Developers → ваше приложение → Tools → Graph API Explorer / System User →
                  токен с правами{" "}
                  <code className="font-mono">pages_show_list</code>,{" "}
                  <code className="font-mono">instagram_basic</code>,{" "}
                  <code className="font-mono">instagram_manage_insights</code>.
                </p>
              </div>
            )}

            {hasSavedMetaToken && (
              <div className="space-y-1.5">
                <Label className="text-xs">Другой токен (опционально)</Label>
                <Input
                  type="password"
                  value={metaToken}
                  onChange={(e) => setMetaToken(e.target.value)}
                  placeholder="Оставьте пустым, чтобы использовать сохранённый"
                  className="font-mono text-xs"
                  autoComplete="off"
                />
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => void openMetaDialog()}
                disabled={listing || savingMeta || (!hasSavedMetaToken && !metaToken.trim())}
                className="gap-2"
              >
                {(listing || savingMeta) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Instagram className="h-4 w-4" />}
                Выбрать Instagram аккаунт
              </Button>
              <Button variant="outline" asChild className="gap-2">
                <Link to="/settings?tab=meta-tokens">
                  <Facebook className="h-4 w-4" />
                  Meta / Facebook OAuth
                </Link>
              </Button>
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-background/40 p-3">
            <button
              type="button"
              className="text-xs font-semibold text-muted-foreground hover:text-foreground"
              onClick={() => setShowLoginAlt((v) => !v)}
            >
              {showLoginAlt ? "▾" : "▸"} Альтернатива: Instagram Login токен (без Facebook Page)
            </button>
            {showLoginAlt && (
              <div className="mt-3 space-y-2">
                <p className="text-[11px] text-muted-foreground">
                  Meta App Dashboard → продукт «Instagram» → Generate token (IGAA… / IGQV…).
                </p>
                <div className="flex items-center gap-2">
                  <Input
                    type="password"
                    placeholder="IGAA… / IGQV…"
                    value={loginToken}
                    onChange={(e) => setLoginTokenInput(e.target.value)}
                    className="font-mono text-xs"
                  />
                  <Button
                    size="sm"
                    onClick={() => void handleConnectWithLoginToken()}
                    disabled={savingLogin || !loginToken.trim()}
                    className="shrink-0"
                  >
                    {savingLogin ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Связать"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-4">
            {account.profilePictureUrl && (
              <img src={account.profilePictureUrl} alt="" className="h-14 w-14 rounded-full object-cover ring-2 ring-pink-500/40" />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <div className="font-semibold truncate">@{account.username}</div>
                {account.active && <CheckCircle2 className="h-4 w-4 text-success shrink-0" />}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {account.name}
                {account.pageName ? ` · ${account.pageName}` : " · Instagram Login"}
              </div>
            </div>
            <div className="text-right text-xs text-muted-foreground hidden sm:block">
              <div><b className="text-foreground">{fmtNum(account.followersCount)}</b> подписчиков</div>
              <div><b className="text-foreground">{fmtNum(account.mediaCount)}</b> публикаций</div>
            </div>
          </div>

          {account.lastError && (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{account.lastError}</span>
            </div>
          )}

          {!account.igLoginTokenPresent && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-100">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Нет Instagram Login токена — публичный ответ на комментарий может уйти, а Direct по код-слову
                («хаб») чаще всего нет. Вставьте IGAA… ниже.
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void handleSync()} disabled={loading} className="gap-1">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Синхронизировать
            </Button>
            <Button variant="outline" size="sm" onClick={() => void openMetaDialog()} className="gap-1">
              Сменить через Meta-токен
            </Button>
            <Button variant="ghost" size="sm" onClick={handleDisconnect} className="gap-1 text-destructive hover:text-destructive">
              <Unplug className="h-3.5 w-3.5" />
              Отключить
            </Button>
            {account.lastSyncAt && (
              <span className="text-[11px] text-muted-foreground ml-auto">
                Последняя синх.: {new Date(account.lastSyncAt).toLocaleString("ru-RU")}
              </span>
            )}
          </div>

          <div className="rounded-xl border border-border/60 bg-background/40 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
              <KeyRound className="h-3.5 w-3.5 text-pink-500" />
              Instagram Login токен для DM
              {account.igLoginTokenPresent && <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
            </div>
            <p className="mb-2 text-[11px] text-muted-foreground">
              Для Direct нужен отдельный Instagram Login токен (если Page-токен не умеет messages).
            </p>
            <div className="flex items-center gap-2">
              <Input
                type="password"
                placeholder={account.igLoginTokenPresent ? "Токен сохранён — вставьте новый" : "IGAA… / IGQV…"}
                value={loginToken}
                onChange={(e) => setLoginTokenInput(e.target.value)}
                className="font-mono text-xs"
              />
              <Button size="sm" onClick={() => void handleSaveLoginToken()} disabled={savingLogin || !loginToken.trim()} className="shrink-0">
                {savingLogin ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Сохранить"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Выберите Instagram аккаунт</DialogTitle>
            <DialogDescription>
              Business-аккаунты из Meta-токена (привязанные к Facebook Page).
            </DialogDescription>
          </DialogHeader>
          {listing ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : listError ? (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <div className="font-semibold">Не удалось получить список</div>
                <div className="mt-1">{listError}</div>
                <div className="mt-2 text-[11px] opacity-80">
                  Добавьте Meta-токен в Настройки → Meta или вставьте EAAG… выше. Нужны права pages_show_list, instagram_basic.
                </div>
              </div>
            </div>
          ) : available.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center space-y-2">
              <p>В токене нет Instagram Business с Facebook Page.</p>
              <p className="text-xs">
                Привяжите IG к Page в Meta Business Suite или используйте Instagram Login токен ниже.
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {available.map((acc) => (
                <button
                  key={acc.ig_user_id}
                  onClick={() => void handleConnect(acc)}
                  disabled={connecting !== null}
                  className="w-full flex items-center gap-3 rounded-xl border border-border/60 p-3 text-left transition hover:border-pink-500/50 hover:bg-pink-500/5 disabled:opacity-50"
                >
                  {acc.profile_picture_url ? (
                    <img src={acc.profile_picture_url} alt="" className="h-10 w-10 rounded-full object-cover" />
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-secondary grid place-items-center">
                      <Instagram className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">@{acc.username}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {fmtNum(acc.followers_count)} подписч. · стр. {acc.page_name}
                    </div>
                  </div>
                  {connecting === acc.ig_user_id && <Loader2 className="h-4 w-4 animate-spin" />}
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
