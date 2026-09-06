/**
 * Пульт облачного телефона: слева само устройство, справа то, ради чего его включали.
 *
 * Почему снимок, а не видео: в Open API PhoneGrid нет ни потока, ни даже endpoint'а снимка —
 * кадр собирается вручную (screencap на телефоне → файл в хранилище → ссылка) и стоит около
 * двенадцати секунд, из которых ~3 с уходит на каждый вызов их API просто так: пустая
 * команда `true` возвращается за 2952 мс. Живое видео есть только в собственном клиенте
 * PhoneGrid — оно идёт по WebRTC через их приватный шлюз, наружу этот канал не выведен.
 *
 * Отсюда две вещи, на которых держится окно: кадры заказываются внахлёст (картинка меняется
 * раз в ~4 с вместо раза в 13), а кликать по ней почти не нужно — приложение открывается
 * кнопкой, вход делает сценарий, читающий разметку экрана Android.
 *
 * Пароли площадок платформа не хранит: значение уходит на телефон и нигде не остаётся.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Circle, Globe, Loader2, Power, RefreshCw, Square, Video, Wifi } from "lucide-react";
import { toast } from "sonner";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { PhoneLoginPanel } from "@/components/publishing/PhoneLoginPanel";
import { PhoneAppsPanel } from "@/components/publishing/PhoneAppsPanel";
import {
  connectAccountOnPhone, listPhones, phoneApps, phoneInput, phoneNet, phoneOpenUrl,
  phoneScreen, setPhonePower, PHONE_APPS,
  type DevicePhone, type LoginPlatform, type PhoneApps, type PhoneKey, type PhoneNet,
  type PhoneShot, type ShotFormat,
} from "@/lib/accountDevices";

/** Пока кадра нет, считаем экран обычным 1080×2400; после первого снимка берём настоящий. */
const DEFAULT_SCREEN = { width: 1080, height: 2400 };

/** Телефон тарифицируется поминутно — время работы должно быть на виду, а не в кабинете. */
function uptimeLabel(seconds: number): string {
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} мин`;
  return `${Math.floor(m / 60)} ч ${m % 60} мин`;
}

export function PhoneScreenDialog({
  open, phone, onClose,
}: {
  open: boolean;
  phone: DevicePhone;
  onClose: () => void;
}) {
  const { activeId: projectId } = useProjectsStore();
  const [shot, setShot] = useState<PhoneShot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Сколько кадров сейчас в пути: их заказывают внахлёст, иначе картинка меняется раз в 13 с. */
  const [pending, setPending] = useState(0);
  const [format, setFormat] = useState<ShotFormat>("png");
  const [text, setText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [apps, setApps] = useState<PhoneApps | null>(null);
  const [net, setNet] = useState<PhoneNet | null>(null);
  const [netLoading, setNetLoading] = useState(false);
  const [platform, setPlatform] = useState<LoginPlatform>(
    phone.account?.platform === "tiktok" ? "tiktok" : "instagram",
  );
  const [auto, setAuto] = useState(false);
  // Статус живёт своей жизнью: телефон включается около минуты, и окно должно
  // это показывать, а не замирать на «выключен».
  const [status, setStatus] = useState(phone.status);
  const [statusText, setStatusText] = useState(phone.statusText);

  const mediaRef = useRef<HTMLDivElement>(null);
  // Номера запросов: кадр, обогнавший более свежий, показывать нельзя — картинка прыгнет назад.
  const seqRef = useRef(0);
  const appliedRef = useRef(0);
  const inFlightRef = useRef(0);
  // Формат держим и в ref: `refresh` зовут сразу из обработчика, до перерисовки.
  const formatRef = useRef<ShotFormat>("png");

  /**
   * Заказать кадр. Один кадр у PhoneGrid готовится ~12 секунд и ускорить это нельзя — но
   * снимки можно заказывать внахлёст, и тогда картинка меняется раз в ~4 секунды.
   * Записи движения внахлёст не идут: два `screenrecord` разом Android не тянет, оба
   * возвращаются пустыми, поэтому в этом режиме заказ ровно один.
   */
  const refresh = useCallback(async () => {
    const limit = formatRef.current === "mp4" ? 1 : 3;
    if (!projectId || inFlightRef.current >= limit) return;
    const seq = ++seqRef.current;
    inFlightRef.current += 1;
    setPending(inFlightRef.current);
    try {
      const next = await phoneScreen(projectId, phone.id, formatRef.current);
      if (seq > appliedRef.current) {
        appliedRef.current = seq;
        setShot(next);
        setError(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlightRef.current -= 1;
      setPending(inFlightRef.current);
    }
  }, [projectId, phone.id]);

  const syncStatus = useCallback(async () => {
    if (!projectId) return;
    try {
      const fresh = (await listPhones(projectId)).find((p) => p.id === phone.id);
      if (fresh) {
        setStatus(fresh.status);
        setStatusText(fresh.statusText);
      }
    } catch {
      /* статус не обновился — покажем прежний */
    }
  }, [projectId, phone.id]);

  const loadApps = useCallback(async () => {
    if (!projectId) return;
    try {
      setApps(await phoneApps(projectId, phone.id));
    } catch {
      /* каталог не критичен: экран и ввод работают без него */
    }
  }, [projectId, phone.id]);

  const checkNet = useCallback(async () => {
    if (!projectId) return;
    setNetLoading(true);
    try {
      setNet(await phoneNet(projectId, phone.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setNetLoading(false);
    }
  }, [projectId, phone.id]);

  useEffect(() => {
    if (!open) return;
    if (status === 4) {
      void refresh();
      void loadApps();
      void checkNet();
      return;
    }
    // Пока телефон загружается — опрашиваем статус, чтобы экран появился сам.
    if (status === 3) {
      const t = setInterval(() => void syncStatus(), 10_000);
      return () => clearInterval(t);
    }
  }, [open, status, refresh, loadApps, checkNet, syncStatus]);

  useEffect(() => {
    if (!open || !auto || status !== 4) return;
    // Заказываем чаще, чем готовится кадр: очередь из трёх заказов даёт картинку раз в ~4 с
    // вместо раза в 13. Лишние заказы `refresh` отсечёт сам.
    const t = setInterval(() => void refresh(), 3500);
    return () => clearInterval(t);
  }, [open, auto, status, refresh]);

  /** Действие на телефоне и сразу свежий кадр — иначе не видно, что получилось. */
  const act = useCallback(async (fn: () => Promise<unknown>) => {
    if (!projectId || busy) return;
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [projectId, busy, refresh]);

  /**
   * Клик по картинке → тап в тех же координатах на устройстве. Считаем по реальному
   * разрешению кадра: у моделей оно разное (1080×2340 и 1080×2400), и на фиксированном
   * числе палец уезжал бы вниз на десятки пикселей.
   */
  const onScreenClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const box = mediaRef.current;
    if (!box) return;
    const size = shot ?? DEFAULT_SCREEN;
    const rect = box.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * size.width);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * size.height);
    void act(() => phoneInput(projectId!, phone.id, { kind: "tap", x, y }));
  };

  const key = (k: PhoneKey) => void act(() => phoneInput(projectId!, phone.id, { kind: "key", key: k }));

  const off = status !== 4;
  const booting = status === 3;

  const power = async (on: boolean) => {
    if (!projectId) return;
    setBusy(true);
    try {
      await setPhonePower(projectId, phone.id, on);
      toast.success(on ? "Включаем — телефон поднимется примерно за минуту" : "Телефон выключен");
      setStatus(on ? 3 : 2);
      setStatusText(on ? "загружается" : "выключен");
      if (!on) setShot(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl gap-4">
        <DialogHeader className="space-y-1">
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-8">
            <span>{phone.name}</span>
            <Badge variant={off ? "secondary" : "default"}>{statusText}</Badge>
            {net && (
              <Badge variant="outline" className="gap-1 font-normal">
                <Wifi className="h-3 w-3" />{net.ip}
              </Badge>
            )}
            {!off && shot && shot.uptime > 0 && (
              <Badge variant="outline" className="font-normal">
                работает {uptimeLabel(shot.uptime)}
              </Badge>
            )}
            {!off && (
              <Button
                size="sm" variant="ghost" className="ml-auto h-7 text-muted-foreground"
                disabled={busy}
                title="Телефон тарифицируется поминутно — гасите его сразу после работы"
                onClick={() => void power(false)}
              >
                <Power className="mr-1.5 h-3.5 w-3.5" /> Выключить
              </Button>
            )}
          </DialogTitle>
          <DialogDescription>
            Приложение открывается кнопкой, вход делает сценарий. По картинке тоже можно кликать.
          </DialogDescription>
        </DialogHeader>

        {off ? (
          <div className="space-y-3 py-12 text-center">
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
                <Button size="sm" disabled={busy} onClick={() => void power(true)}>
                  {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Включить телефон
                </Button>
              </>
            )}
          </div>
        ) : (
          <div className="flex gap-6">
            {/* Устройство: корпус, экран, под ним — навигация Android, как на настоящем телефоне. */}
            <div className="w-[330px] shrink-0 space-y-2">
              <div className="rounded-[2rem] border-[6px] border-foreground/10 bg-foreground/10 p-1.5 shadow-sm">
                <div
                  ref={mediaRef}
                  onClick={shot ? onScreenClick : undefined}
                  className="relative overflow-hidden rounded-[1.5rem] bg-background"
                  style={{ aspectRatio: `${(shot ?? DEFAULT_SCREEN).width} / ${(shot ?? DEFAULT_SCREEN).height}` }}
                >
                  {shot
                    ? shot.format === "mp4"
                      ? (
                        // Полторы секунды движения вместо застывшего кадра — и в 13 раз легче.
                        <video
                          key={shot.url} src={shot.url}
                          className="w-full cursor-crosshair select-none"
                          autoPlay muted loop playsInline
                        />
                      )
                      : (
                        <img
                          src={shot.url} alt={`Экран ${phone.name}`}
                          className="w-full cursor-crosshair select-none" draggable={false}
                        />
                      )
                    : (
                      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                        {pending > 0 ? "Снимаем экран…" : "Нет кадра"}
                      </div>
                    )}
                  {pending > 0 && shot && (
                    <div className="absolute right-2 top-2 rounded-full bg-background/80 p-1.5 shadow">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-center gap-8 py-2 text-foreground/50">
                  <button type="button" title="Назад" disabled={busy} onClick={() => key("back")}>
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  <button type="button" title="Домой" disabled={busy} onClick={() => key("home")}>
                    <Circle className="h-4 w-4" />
                  </button>
                  <button type="button" title="Недавние" disabled={busy} onClick={() => key("recent")}>
                    <Square className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap justify-center gap-1.5">
                <Button size="sm" variant="outline" onClick={() => void refresh()}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Обновить
                </Button>
                <Button
                  size="sm" variant={auto ? "default" : "outline"}
                  onClick={() => setAuto((v) => !v)}
                  title="Заказывать кадры непрерывно, по нескольку сразу: картинка меняется примерно раз в 4 секунды"
                >
                  {auto ? "Авто: вкл" : "Авто"}
                </Button>
                <Button
                  size="sm" variant={format === "mp4" ? "default" : "outline"}
                  title="Полторы секунды реального движения вместо застывшего кадра — и всего 90 КБ против 1,2 МБ. Приходит реже (записи нельзя вести внахлёст) и мельче по чёткости: для мелкого текста вернитесь в «Кадр»."
                  onClick={() => {
                    const next: ShotFormat = format === "mp4" ? "png" : "mp4";
                    formatRef.current = next;
                    setFormat(next);
                    void refresh();
                  }}
                >
                  <Video className="mr-1.5 h-3.5 w-3.5" /> {format === "mp4" ? "Движение" : "Кадр"}
                </Button>
              </div>
              {error && <p className="text-center text-xs text-destructive">{error}</p>}
            </div>

            <Tabs defaultValue="login" className="flex-1">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="login">Вход</TabsTrigger>
                <TabsTrigger value="apps">Приложения</TabsTrigger>
                <TabsTrigger value="net">Сеть</TabsTrigger>
                <TabsTrigger value="input">Ввод</TabsTrigger>
              </TabsList>

              <div className="mt-3 max-h-[62vh] overflow-y-auto pr-1">
                <TabsContent value="login" className="mt-0">
                  {projectId && (
                    <PhoneLoginPanel
                      projectId={projectId} phoneId={phone.id} platform={platform}
                      apps={apps} net={net} proxyIp={phone.proxyIp} busy={busy}
                      onPlatform={setPlatform} onAct={act}
                      onScreenChanged={() => void refresh()}
                    />
                  )}

                  <div className="mt-4 space-y-1.5 border-t pt-3">
                    <label className="text-sm font-medium">Подключить аккаунт к платформе</label>
                    <p className="text-xs text-muted-foreground">
                      Откроем на телефоне страницу подключения. Вы входите на площадке прямо там —
                      вход идёт с IP этого телефона, — а платформа получает токен и заводит аккаунт
                      со статистикой и автопубликацией.
                    </p>
                    <Button
                      size="sm" variant="outline" disabled={busy}
                      onClick={() => void act(async () => {
                        const r = await connectAccountOnPhone(projectId!, phone.id);
                        toast.success("Страница подключения открыта на телефоне");
                        return r;
                      })}
                    >
                      Открыть подключение на телефоне
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="apps" className="mt-0">
                  {projectId && (
                    <PhoneAppsPanel
                      projectId={projectId} phoneId={phone.id}
                      apps={apps} busy={busy} onAct={act} onReload={() => void loadApps()}
                    />
                  )}
                </TabsContent>

                <TabsContent value="net" className="mt-0 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Откуда телефон выходит в сеть</span>
                    <Button size="sm" variant="outline" disabled={netLoading} onClick={() => void checkNet()}>
                      {netLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Проверить"}
                    </Button>
                  </div>
                  {net ? (
                    <div className="space-y-2 text-sm">
                      <div className="rounded-lg border p-3">
                        <div className="text-lg font-medium">{net.ip}</div>
                        <div className="text-xs text-muted-foreground">
                          {[net.isp, net.city, net.country].filter(Boolean).join(" · ")}
                          {net.mobile ? " · мобильный" : ""}
                        </div>
                      </div>
                      {phone.proxyIp && phone.proxyIp !== net.ip && (
                        <p className="text-xs text-muted-foreground">
                          В карточке телефона стоит прокси {phone.proxyIp} — это адрес его шлюза.
                          Наружу телефон выходит с {net.ip}: у ротационного мобильного прокси адрес
                          меняется, и площадка видит именно этот.
                        </p>
                      )}
                      {!phone.proxyIp && (
                        <p className="text-xs text-destructive">
                          Прокси не привязан — телефон выходит напрямую. Для заведения аккаунта так делать не стоит.
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Проверьте перед входом: важно, чтобы авторизация шла через прокси телефона, а не мимо.
                    </p>
                  )}
                </TabsContent>

                <TabsContent value="input" className="mt-0 space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Текст на телефон</label>
                    <div className="flex gap-1.5">
                      <Input
                        value={text} disabled={busy} className="h-9"
                        onChange={(e) => setText(e.target.value)}
                        placeholder="Код подтверждения или любой текст"
                      />
                      <Button
                        size="sm" disabled={busy || !text}
                        onClick={() => void act(async () => {
                          await phoneInput(projectId!, phone.id, { kind: "text", text });
                          setText("");
                        })}
                      >
                        Ввести
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Идёт в поле, которое сейчас в фокусе на телефоне. Android принимает только
                      латиницу, цифры и знаки — кириллицу так не набрать.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Открыть ссылку в браузере телефона</label>
                    <div className="flex gap-1.5">
                      <Input
                        value={linkUrl} disabled={busy} className="h-9"
                        onChange={(e) => setLinkUrl(e.target.value)}
                        placeholder="https://…"
                      />
                      <Button
                        size="sm" variant="outline" disabled={busy || !linkUrl.trim()}
                        onClick={() => void act(async () => {
                          await phoneOpenUrl(projectId!, phone.id, linkUrl.trim());
                          setLinkUrl("");
                        })}
                      >
                        <Globe className="mr-1.5 h-3.5 w-3.5" /> Открыть
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Подключение аккаунта к платформе (OAuth) лучше проходить отсюда: вход на
                      площадку пойдёт с IP этого телефона, а не с сервера.
                    </p>
                  </div>
                </TabsContent>
              </div>
            </Tabs>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
