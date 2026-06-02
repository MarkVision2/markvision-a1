import { useState } from "react";
import { Instagram, RefreshCw, Loader2, AlertCircle, Unplug, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useInstagramAccount, type AvailableIgAccount } from "@/hooks/useInstagramAccount";

const fmtNum = (n: number) => Math.round(n).toLocaleString("ru-RU");

export function InstagramAccountConnect() {
  const { account, loading, listAvailable, connect, disconnect, sync } = useInstagramAccount();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [available, setAvailable] = useState<AvailableIgAccount[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [listing, setListing] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);

  const openDialog = async () => {
    setDialogOpen(true);
    setListing(true);
    setListError(null);
    const { accounts, error } = await listAvailable();
    setAvailable(accounts);
    if (error) setListError(error);
    setListing(false);
  };

  const handleConnect = async (acc: AvailableIgAccount) => {
    setConnecting(acc.ig_user_id);
    try {
      await connect(acc);
      toast.success(`Подключён @${acc.username}`);
      setDialogOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка подключения");
    } finally {
      setConnecting(null);
    }
  };

  const handleSync = async () => {
    try {
      await sync();
      toast.success("Синхронизация запущена");
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

      {!account ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Подключите Business аккаунт, чтобы собирать охват, лайки, комментарии, репосты, реакции на Reels и Stories.
            Подключение идёт через ваш Meta-токен — отдельный логин не нужен.
          </p>
          <Button onClick={openDialog} className="gap-2">
            <Instagram className="h-4 w-4" />
            Подключить Instagram
          </Button>
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
              <div className="text-xs text-muted-foreground truncate">{account.name} · страница {account.pageName}</div>
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

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleSync} disabled={loading} className="gap-1">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Синхронизировать
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
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Выберите Instagram аккаунт</DialogTitle>
            <DialogDescription>
              Доступны Business аккаунты, привязанные к страницам Facebook вашего Meta-токена.
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
                  Проверьте, что Meta-токен имеет права: pages_show_list, pages_read_engagement, instagram_basic, instagram_manage_insights.
                </div>
              </div>
            </div>
          ) : available.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              Не нашли подключённых Instagram Business аккаунтов. Привяжите IG к странице Facebook в настройках Meta.
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {available.map((acc) => (
                <button
                  key={acc.ig_user_id}
                  onClick={() => handleConnect(acc)}
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
