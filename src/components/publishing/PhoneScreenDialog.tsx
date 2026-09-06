/**
 * Окно телефона: экран устройства прямо в платформе — посмотреть, ткнуть, ввести текст,
 * открыть ссылку в его браузере.
 *
 * Кадр снимается по запросу и живёт секунды: это не видеопоток, а снимок экрана, которого
 * хватает, чтобы зарегистрировать аккаунт и проверить, что происходит. Полноценное видео
 * PhoneGrid наружу не отдаёт — оно есть только в его собственном клиенте.
 *
 * Пароли площадок платформа не хранит и не подставляет: логин и код вводит человек здесь же,
 * на экране телефона, и они остаются внутри устройства.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Circle, Globe, Loader2, RefreshCw, Square } from "lucide-react";
import { toast } from "sonner";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import {
  installApp, listPhones, phoneApps, phoneInput, phoneOpenUrl, phoneScreen, setPhonePower,
  type DevicePhone, type PhoneApps, type PhoneKey,
} from "@/lib/accountDevices";

/** Экран устройства в пикселях — по нему пересчитываем клик в координаты тапа. */
const SCREEN = { width: 1080, height: 2400 };

export function PhoneScreenDialog({
  open, phone, onClose,
}: {
  open: boolean;
  phone: DevicePhone;
  onClose: () => void;
}) {
  const { activeId: projectId } = useProjectsStore();
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [apps, setApps] = useState<PhoneApps | null>(null);
  // Статус живёт своей жизнью: телефон включается около минуты, и окно должно
  // это показывать, а не замирать на «выключен».
  const [status, setStatus] = useState(phone.status);
  const [statusText, setStatusText] = useState(phone.statusText);
  const imgRef = useRef<HTMLImageElement>(null);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      setUrl(await phoneScreen(projectId, phone.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [projectId, phone.id]);

  const syncStatus = useCallback(async () => {
    if (!projectId) return phone.status;
    try {
      const fresh = (await listPhones(projectId)).find((p) => p.id === phone.id);
      if (fresh) {
        setStatus(fresh.status);
        setStatusText(fresh.statusText);
        return fresh.status;
      }
    } catch {
      /* статус не обновился — покажем прежний */
    }
    return phone.status;
  }, [projectId, phone.id, phone.status]);

  const loadApps = useCallback(async () => {
    if (!projectId) return;
    try {
      setApps(await phoneApps(projectId, phone.id));
    } catch {
      /* каталог не критичен: экран и ввод работают без него */
    }
  }, [projectId, phone.id]);

  useEffect(() => {
    if (!open) return;
    if (status === 4) {
      void refresh();
      void loadApps();
      return;
    }
    // Пока телефон загружается — опрашиваем статус, чтобы экран появился сам.
    if (status === 3) {
      const t = setInterval(() => void syncStatus(), 10_000);
      return () => clearInterval(t);
    }
  }, [open, status, refresh, loadApps, syncStatus]);

  /** Действие на телефоне и сразу свежий кадр — иначе не видно, что получилось. */
  const send = async (fn: () => Promise<unknown>) => {
    if (!projectId || loading) return;
    setLoading(true);
    try {
      await fn();
      setUrl(await phoneScreen(projectId, phone.id));
      setError(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  /** Клик по картинке → тап в тех же координатах на устройстве. */
  const onScreenClick = (e: React.MouseEvent<HTMLImageElement>) => {
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * SCREEN.width);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * SCREEN.height);
    void send(() => phoneInput(projectId!, phone.id, { kind: "tap", x, y }));
  };

  const key = (k: PhoneKey) => void send(() => phoneInput(projectId!, phone.id, { kind: "key", key: k }));

  const off = status !== 4;
  const booting = status === 3;

  /** Включение прямо из окна: искать кнопку в списке — лишний шаг. */
  const powerOn = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      await setPhonePower(projectId, phone.id, true);
      toast.success("Включаем — телефон поднимется примерно за минуту");
      await syncStatus();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {phone.name}
            <Badge variant={off ? "secondary" : "default"}>{statusText}</Badge>
            {phone.proxyIp && <Badge variant="outline">{phone.proxyIp}</Badge>}
          </DialogTitle>
          <DialogDescription>
            Экран устройства. Кликните по нему — телефон получит тап в этом месте. Кадр снимается
            по запросу, поэтому обновляется за несколько секунд, а не как видео.
          </DialogDescription>
        </DialogHeader>

        {off ? (
          <div className="space-y-3 py-10 text-center">
            {booting ? (
              <>
                <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Телефон загружается — обычно около минуты. Экран появится сам.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Телефон выключен. Включите его — и увидите экран прямо здесь.
                </p>
                <Button size="sm" disabled={loading} onClick={() => void powerOn()}>
                  {loading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Включить телефон
                </Button>
              </>
            )}
          </div>
        ) : (
          <div className="flex gap-4">
            <div className="relative w-[280px] shrink-0 overflow-hidden rounded-xl border bg-muted">
              {url ? (
                <img
                  ref={imgRef} src={url} alt={`Экран ${phone.name}`}
                  className="w-full cursor-crosshair select-none" draggable={false}
                  onClick={onScreenClick}
                />
              ) : (
                <div className="flex h-[560px] items-center justify-center text-sm text-muted-foreground">
                  {loading ? "Снимаем экран…" : "Нет кадра"}
                </div>
              )}
              {loading && url && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/50">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              )}
            </div>

            <div className="flex-1 space-y-3">
              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" disabled={loading} onClick={() => void refresh()}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Обновить
                </Button>
                <Button size="sm" variant="outline" disabled={loading} onClick={() => key("back")} title="Назад">
                  <ArrowLeft className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="outline" disabled={loading} onClick={() => key("home")} title="Домой">
                  <Circle className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="outline" disabled={loading} onClick={() => key("recent")} title="Недавние">
                  <Square className="h-3.5 w-3.5" />
                </Button>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Ввести текст</label>
                <div className="flex gap-1.5">
                  <Input
                    value={text} disabled={loading} className="h-8"
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Сначала ткните в поле на экране"
                  />
                  <Button
                    size="sm" disabled={loading || !text}
                    onClick={() => void send(async () => {
                      await phoneInput(projectId!, phone.id, { kind: "text", text });
                      setText("");
                    })}
                  >
                    Ввести
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Пароли и коды вводите здесь же — они остаются внутри телефона, платформа их не хранит.
                </p>
              </div>

              {apps && (
                <div className="space-y-1.5 border-t pt-3">
                  <label className="text-sm font-medium">Приложения</label>
                  {apps.installed.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {apps.installed.map((a) => (
                        <Badge key={a.packageName} variant="outline">{a.appName} {a.version}</Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Пока ничего не установлено.</p>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {apps.catalog.filter((c) => !apps.installed.some((i) => i.packageName === c.packageName)).map((c) => (
                      <Button
                        key={c.packageName} size="sm" variant="outline"
                        disabled={loading || !c.warmupVersionId}
                        title={c.warmupVersion
                          ? `Поставим версию ${c.warmupVersion} — её требует сценарий прогрева`
                          : "Для этой площадки версия под прогрев ещё не выяснена"}
                        onClick={() => void send(async () => {
                          await installApp(projectId!, phone.id, c.warmupVersionId!);
                          toast.success(`${c.appName} ставится — займёт до минуты`);
                          setTimeout(() => void loadApps(), 30_000);
                        })}
                      >
                        Поставить {c.appName}
                      </Button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Ставим сразу версию под прогрев — иначе позже придётся переустанавливать
                    приложение, и вход в аккаунт слетит.
                  </p>
                </div>
              )}

              <div className="space-y-1.5 border-t pt-3">
                <label className="text-sm font-medium">Открыть ссылку в браузере телефона</label>
                <div className="flex gap-1.5">
                  <Input
                    value={linkUrl} disabled={loading} className="h-8"
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder="https://…"
                  />
                  <Button
                    size="sm" variant="outline" disabled={loading || !linkUrl.trim()}
                    onClick={() => void send(async () => {
                      await phoneOpenUrl(projectId!, phone.id, linkUrl.trim());
                      setLinkUrl("");
                    })}
                  >
                    <Globe className="mr-1.5 h-3.5 w-3.5" /> Открыть
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Подключать аккаунт к платформе лучше отсюда: вход на площадку пойдёт с IP этого
                  телефона, а не с сервера.
                </p>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
