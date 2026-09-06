/**
 * Окно телефона: экран устройства прямо в платформе — открыть приложение, войти в аккаунт,
 * ткнуть, ввести текст, проверить, с какого адреса телефон выходит в сеть.
 *
 * Почему снимок, а не видео: в Open API PhoneGrid нет ни потока, ни даже endpoint'а снимка —
 * кадр собирается вручную (screencap на телефоне → файл в хранилище → ссылка) и занимает
 * 3–9 секунд. Живое видео есть только в собственном клиенте PhoneGrid: оно идёт по WebRTC
 * через их приватный шлюз, наружу этот канал не выведен. Поэтому ставка здесь не на
 * плавную картинку, а на то, чтобы по картинке почти не приходилось кликать: приложение
 * открывается кнопкой, вход делает сценарий, читающий разметку экрана Android.
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
import { ArrowLeft, Circle, Globe, Loader2, RefreshCw, Square, Video, Wifi } from "lucide-react";
import { toast } from "sonner";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { PhoneLoginPanel } from "@/components/publishing/PhoneLoginPanel";
import {
  connectAccountOnPhone,
  installApp, listPhones, phoneAppStart, phoneAppStop, phoneApps, phoneInput, phoneNet,
  phoneOpenUrl, phoneScreen, setPhonePower, uninstallApp, PHONE_APPS,
  type DevicePhone, type LoginPlatform, type PhoneApps, type PhoneKey, type PhoneNet, type PhoneShot,
  type ShotFormat,
} from "@/lib/accountDevices";

/** Пока кадра нет, считаем экран обычным 1080×2400; после первого снимка берём настоящий. */
const DEFAULT_SCREEN = { width: 1080, height: 2400 };

export function PhoneScreenDialog({
  open, phone, onClose,
}: {
  open: boolean;
  phone: DevicePhone;
  onClose: () => void;
}) {
  const { activeId: projectId } = useProjectsStore();
  const [shot, setShot] = useState<PhoneShot | null>(null);
  const [loading, setLoading] = useState(false);
  /** Сколько кадров сейчас в пути: их снимают внахлёст, иначе картинка обновлялась бы раз в 13 с. */
  const [pending, setPending] = useState(0);
  const [format, setFormat] = useState<ShotFormat>("png");
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [apps, setApps] = useState<PhoneApps | null>(null);
  const [net, setNet] = useState<PhoneNet | null>(null);
  const [netLoading, setNetLoading] = useState(false);
  const [platform, setPlatform] = useState<LoginPlatform>(
    phone.account?.platform === "tiktok" ? "tiktok" : "instagram",
  );
  // Автообновление: страница в браузере телефона грузится не мгновенно, и без него
  // непонятно, идёт что-то или зависло.
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

  /** Действие на телефоне и сразу свежий кадр — иначе не видно, что получилось. */
  const send = async (fn: () => Promise<unknown>) => {
    if (!projectId || loading) return;
    setLoading(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

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
    void send(() => phoneInput(projectId!, phone.id, { kind: "tap", x, y }));
  };

  const key = (k: PhoneKey) => void send(() => phoneInput(projectId!, phone.id, { kind: "key", key: k }));

  useEffect(() => {
    if (!open || !auto || status !== 4) return;
    // Заказываем чаще, чем готовится кадр: очередь из трёх заказов даёт картинку раз в ~3,5 с
    // вместо раза в 13. Лишние заказы `refresh` отсечёт сам.
    const t = setInterval(() => void refresh(), 3500);
    return () => clearInterval(t);
  }, [open, auto, status, refresh]);

  const off = status !== 4;
  const booting = status === 3;
  const installed = (pkg: string) => (apps?.installed ?? []).some((a) => a.packageName === pkg);
  /**
   * Стоит не та версия: шаблон прогрева требует ровно свою и падает на сервере PhoneGrid,
   * не доходя до телефона. Поверх такой версии нужная не встанет — только снести и поставить.
   */
  const wrongVersion = (c: PhoneApps["catalog"][number]) =>
    Boolean(c.warmupVersion)
    && (apps?.installed ?? []).some((a) => a.packageName === c.packageName && a.version !== c.warmupVersion);

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
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {phone.name}
            <Badge variant={off ? "secondary" : "default"}>{statusText}</Badge>
            {net
              ? <Badge variant="outline" className="gap-1"><Wifi className="h-3 w-3" />{net.ip}</Badge>
              : phone.proxyIp && <Badge variant="outline">прокси {phone.proxyIp}</Badge>}
          </DialogTitle>
          <DialogDescription>
            Экран устройства. Приложение открывается кнопкой, вход — сценарием: платформа
            читает разметку экрана и жмёт сама. Кликать по картинке тоже можно, но кадр
            снимается по запросу и обновляется за несколько секунд, а не как видео.
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
          <div className="flex gap-5">
            <div className="w-[340px] shrink-0 space-y-2">
              <div
                ref={mediaRef}
                onClick={shot ? onScreenClick : undefined}
                className="relative overflow-hidden rounded-xl border bg-muted"
                style={shot ? { aspectRatio: `${shot.width} / ${shot.height}` } : undefined}
              >
                {shot
                  ? shot.format === "mp4"
                    ? (
                      // Секунда движения вместо застывшего кадра — и весит в 25 раз меньше.
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
                    <div className="flex h-[680px] items-center justify-center text-sm text-muted-foreground">
                      {pending > 0 ? "Снимаем экран…" : "Нет кадра"}
                    </div>
                  )}
                {pending > 0 && shot && (
                  <div className="absolute right-2 top-2 rounded-full bg-background/80 p-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" onClick={() => void refresh()}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Обновить
                </Button>
                <Button
                  size="sm" variant={auto ? "default" : "outline"}
                  onClick={() => setAuto((v) => !v)}
                  title="Заказывать кадры непрерывно, по нескольку сразу: картинка меняется примерно раз в 3,5 секунды"
                >
                  {auto ? "Авто: вкл" : "Авто"}
                </Button>
                <Button
                  size="sm" variant={format === "mp4" ? "default" : "outline"}
                  onClick={() => {
                    const next: ShotFormat = format === "mp4" ? "png" : "mp4";
                    formatRef.current = next;
                    setFormat(next);
                    void refresh();
                  }}
                  title="Полторы секунды реального движения вместо застывшего кадра — и всего 90 КБ против 1,2 МБ. Приходит реже (записи нельзя вести внахлёст) и мельче по чёткости: для мелкого текста вернитесь в «Кадр»."
                >
                  <Video className="mr-1.5 h-3.5 w-3.5" /> {format === "mp4" ? "Движение" : "Кадр"}
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
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto pr-1" style={{ maxHeight: "70vh" }}>
              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Приложение площадки</label>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.entries(PHONE_APPS) as [LoginPlatform, { packageName: string; label: string }][])
                    .map(([key_, app]) => (
                      <Button
                        key={key_}
                        size="sm"
                        variant={platform === key_ ? "default" : "outline"}
                        disabled={loading || !installed(app.packageName)}
                        title={installed(app.packageName)
                          ? `Открыть ${app.label} на телефоне`
                          : `${app.label} не установлен — поставьте его ниже`}
                        onClick={() => {
                          setPlatform(key_);
                          void send(() => phoneAppStart(projectId!, phone.id, app.packageName));
                        }}
                      >
                        {app.label}
                      </Button>
                    ))}
                  <Button
                    size="sm" variant="outline" disabled={loading}
                    title="Закрыть приложение — вход начнётся с чистого экрана"
                    onClick={() => void send(() => phoneAppStop(projectId!, phone.id, PHONE_APPS[platform].packageName))}
                  >
                    Закрыть
                  </Button>
                </div>
              </div>

              {projectId && (
                <div className="border-t pt-3">
                  <PhoneLoginPanel
                    projectId={projectId} phoneId={phone.id} platform={platform}
                    onScreenChanged={() => void refresh()}
                  />
                </div>
              )}

              <div className="space-y-1.5 border-t pt-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Выход в сеть</label>
                  <Button size="sm" variant="ghost" disabled={netLoading} onClick={() => void checkNet()}>
                    {netLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Проверить"}
                  </Button>
                </div>
                {net ? (
                  <div className="space-y-1 text-xs">
                    <p>
                      Площадка видит вход с <span className="font-medium">{net.ip}</span>
                      {net.isp ? ` · ${net.isp}` : ""}
                      {net.city || net.country ? ` · ${[net.city, net.country].filter(Boolean).join(", ")}` : ""}
                      {net.mobile ? " · мобильный" : ""}
                    </p>
                    {phone.proxyIp && phone.proxyIp !== net.ip && (
                      <p className="text-muted-foreground">
                        В карточке телефона стоит прокси {phone.proxyIp} — это адрес его шлюза.
                        Наружу телефон выходит с {net.ip}: у ротационного мобильного прокси
                        адрес меняется, и площадка видит именно этот.
                      </p>
                    )}
                    {!phone.proxyIp && (
                      <p className="text-destructive">
                        Прокси не привязан — телефон выходит напрямую. Для заведения аккаунта так делать не стоит.
                      </p>
                    )}
                    {/* Ради этого вся затея с устройствами: у каждого аккаунта свой адрес.
                        Совпадение адресов площадка читает как один источник. */}
                    {net.collisionWith && (
                      <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-destructive">
                        С этого же адреса за последний час выходил другой телефон. Площадка увидит
                        аккаунты как один источник — дождитесь смены IP или разведите сессии по времени.
                      </p>
                    )}
                    {!net.collisionWith && net.same && (
                      <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-amber-700 dark:text-amber-500">
                        Адрес тот же, что был в прошлую сессию этого телефона. Для входа в новый
                        аккаунт лучше дождаться смены IP.
                      </p>
                    )}
                    {!net.collisionWith && !net.same && net.previousIp && (
                      <p className="text-muted-foreground">
                        IP сменился с прошлой сессии (было {net.previousIp}) — можно работать.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Проверьте перед входом: важно, чтобы авторизация шла через прокси телефона, а не мимо.
                  </p>
                )}
              </div>

              <div className="space-y-1.5 border-t pt-3">
                <label className="text-sm font-medium">Текст на телефон</label>
                <div className="flex gap-1.5">
                  <Input
                    value={text} disabled={loading} className="h-8"
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Код подтверждения или любой текст"
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
                  Идёт в поле, которое сейчас в фокусе на телефоне. Android принимает только
                  латиницу, цифры и знаки — кириллицу так не набрать.
                </p>
              </div>

              {apps && (
                <div className="space-y-1.5 border-t pt-3">
                  <label className="text-sm font-medium">Установлено</label>
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
                    {apps.catalog.filter((c) => !installed(c.packageName)).map((c) => (
                      <Button
                        key={c.packageName} size="sm" variant="outline"
                        disabled={loading || !c.installVersionId}
                        title={c.warmupVersion
                          ? `Поставим версию ${c.warmupVersion} — её требует сценарий прогрева`
                          : `Поставим свежую версию ${c.installVersion ?? ""}; версия под прогрев для этой площадки ещё не выяснена`}
                        onClick={() => void send(async () => {
                          await installApp(projectId!, phone.id, c.installVersionId!);
                          toast.success(`${c.appName} ставится — займёт до минуты`);
                          setTimeout(() => void loadApps(), 30_000);
                        })}
                      >
                        Поставить {c.appName}
                      </Button>
                    ))}
                    {apps.catalog.filter(wrongVersion).map((c) => (
                      <Button
                        key={`fix-${c.packageName}`} size="sm" variant="outline"
                        disabled={loading || !c.installVersionId}
                        title={`Стоит другая версия — прогрев её не примет. Снесём и поставим ${c.warmupVersion}. Вход в аккаунт при этом слетит.`}
                        onClick={() => void send(async () => {
                          await uninstallApp(projectId!, phone.id, c.packageName);
                          await installApp(projectId!, phone.id, c.installVersionId!);
                          toast.success(`${c.appName} переставляется на ${c.warmupVersion} — до минуты`);
                          setTimeout(() => void loadApps(), 30_000);
                        })}
                      >
                        Переустановить {c.appName} под прогрев
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-1.5 border-t pt-3">
                <label className="text-sm font-medium">Подключить аккаунт к платформе</label>
                <p className="text-xs text-muted-foreground">
                  Откроем на телефоне страницу подключения. Вы входите на площадке прямо там —
                  вход идёт с IP этого телефона, — а платформа получает токен и заводит аккаунт
                  со статистикой и автопубликацией.
                </p>
                <Button
                  size="sm" disabled={loading}
                  onClick={() => void send(async () => {
                    const r = await connectAccountOnPhone(projectId!, phone.id);
                    toast.success("Страница подключения открыта на телефоне");
                    return r;
                  })}
                >
                  Открыть подключение на телефоне
                </Button>
              </div>

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
                  Подключение аккаунта к платформе (OAuth) лучше проходить отсюда: вход на
                  площадку пойдёт с IP этого телефона, а не с сервера.
                </p>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
