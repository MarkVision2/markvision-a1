/**
 * Устройства: все облачные телефоны сети в одном списке — статус, прокси, к какому
 * аккаунту привязан и на каком дне прогрева.
 *
 * Телефон нужен, чтобы аккаунт завести и прогреть; публикация идёт через официальные API
 * площадок и устройства не требует (docs/AUTOPOST-ARCHITECTURE.md). Движок — PhoneGrid,
 * но его кабинет открывать не нужно: всё видно и управляется отсюда.
 *
 * Паролей от площадок здесь нет и быть не может: вход в приложение делает человек
 * руками на самом телефоне.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, MonitorSmartphone, Plus, RefreshCw, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import {
  attachPhone, detachPhone, listFreeAccounts, listPhones, runWarmup, setPhonePower,
  type DeviceAccountRef, type DevicePhone,
} from "@/lib/accountDevices";
import { CreateDeviceDialog } from "@/components/publishing/CreateDeviceDialog";
import { PhoneScreenDialog } from "@/components/publishing/PhoneScreenDialog";

const NONE = "__none";

/**
 * Прогрев запускают раз в день: смысл сценария в том, что активность нарастает по дням,
 * и два прогона подряд ломают именно это. Заодно PhoneGrid отобьёт второй кодом 33309 —
 * телефон занят первой задачей.
 */
function warmedToday(p: DevicePhone): boolean {
  const last = p.warmup?.lastRunAt;
  if (!last) return false;
  return new Date(last).toDateString() === new Date().toDateString();
}

/** Полоса прогрева: 15 дней до готовности. */
function WarmupBar({ day, ready }: { day: number; ready: boolean }) {
  const pct = Math.min(100, Math.round((Math.min(day, 15) / 15) * 100));
  return (
    <div className="min-w-[7rem] space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className={ready ? "text-emerald-600" : ""}>{ready ? "прогрет" : `день ${day}/15`}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${ready ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function DevicesTab() {
  const { activeId: projectId } = useProjectsStore();
  const [phones, setPhones] = useState<DevicePhone[] | null>(null);
  const [free, setFree] = useState<DeviceAccountRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [screenPhone, setScreenPhone] = useState<DevicePhone | null>(null);

  const reload = useCallback(async () => {
    if (!projectId) return;
    setError(null);
    try {
      const [list, accounts] = await Promise.all([listPhones(projectId), listFreeAccounts(projectId)]);
      setPhones(list);
      setFree(accounts);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhones([]);
    }
  }, [projectId]);

  useEffect(() => { void reload(); }, [reload]);

  const act = async (key: string, label: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
      toast.success(label);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return phones ?? [];
    return (phones ?? []).filter((p) =>
      [p.name, p.remark, p.proxyIp, p.country, p.account?.account_name, p.account?.handle]
        .some((v) => (v ?? "").toLowerCase().includes(needle)));
  }, [phones, q]);

  const running = (phones ?? []).filter((p) => p.status === 4).length;
  const busyCount = (phones ?? []).filter((p) => p.account).length;
  // Сколько телефонов сидит на каждом прокси: общий IP связывает аккаунты между собой.
  const perProxy = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of phones ?? []) if (p.proxyIp) m.set(p.proxyIp, (m.get(p.proxyIp) ?? 0) + 1);
    return m;
  }, [phones]);
  const sharedProxies = [...perProxy.entries()].filter(([, n]) => n > 1);
  // Опасна не сама общая запись прокси, а одновременная работа: включённые телефоны
  // выходят с одного адреса в один момент, и площадка видит их как один источник.
  const sharedOnline = [...perProxy.keys()].filter(
    (ip) => (phones ?? []).filter((p) => p.proxyIp === ip && p.status === 4).length > 1,
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-4 w-4" /> Устройства
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Облачные телефоны сети. Нужны, чтобы завести аккаунт и прогреть его — публикация
            идёт через API площадки и телефона не требует, поэтому после работы его выключают.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => void reload()} disabled={busy !== null}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Обновить
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)} disabled={!projectId}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Устройство
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>
        )}

        {phones === null ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Загружаем телефоны…
          </div>
        ) : phones.length === 0 && !error ? (
          <div className="space-y-3 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              Устройств пока нет. Создайте первое — это облачный Android, на котором вы заведёте аккаунт.
            </p>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Создать устройство
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Поиск по имени, прокси, аккаунту…" className="h-8 max-w-xs"
              />
              <Badge variant="outline">всего {phones.length}</Badge>
              <Badge variant="outline">включено {running}</Badge>
              <Badge variant="outline">с аккаунтом {busyCount}</Badge>
            </div>

            {sharedOnline.length > 0 ? (
              <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                Сейчас несколько телефонов включены одновременно на одном адресе ({sharedOnline.join(", ")}).
                Площадка видит их как один источник и связывает аккаунты. Выключите лишние и работайте
                по очереди.
              </p>
            ) : sharedProxies.length > 0 && (
              <p className="rounded-md border p-3 text-sm text-muted-foreground">
                {sharedProxies.map(([ip, n]) => `${n} устройства на прокси ${ip}`).join("; ")}.
                Это нормально, если включать их по очереди: у мобильного прокси адрес меняется со
                временем, и аккаунты выходят с разных IP. Одновременно включать не стоит — тогда все
                они окажутся на одном адресе.
              </p>
            )}

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Телефон</TableHead>
                    <TableHead>Состояние</TableHead>
                    <TableHead>Выход в сеть</TableHead>
                    <TableHead>Аккаунт</TableHead>
                    <TableHead>Прогрев</TableHead>
                    <TableHead className="text-right">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((p) => {
                    const rowBusy = busy === p.id;
                    return (
                      <TableRow key={p.id}>
                        <TableCell>
                          <div className="font-medium">{p.name}</div>
                          {p.remark && <div className="text-xs text-muted-foreground">{p.remark}</div>}
                        </TableCell>
                        <TableCell>
                          <Badge variant={p.status === 4 ? "default" : "secondary"}>{p.statusText}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {p.proxyIp
                            ? (
                              <span className={perProxy.get(p.proxyIp)! > 1 ? "text-muted-foreground" : ""}>
                                {p.proxyIp}{p.country ? ` · ${p.country}` : ""}
                                {perProxy.get(p.proxyIp)! > 1 && " · общий"}
                              </span>
                            )
                            : <span className="text-muted-foreground">без прокси — не включится</span>}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={p.account?.id ?? NONE}
                            disabled={rowBusy}
                            onValueChange={(v) => void act(
                              p.id,
                              v === NONE ? "Телефон отвязан" : "Телефон привязан",
                              async () => {
                                // Один телефон — один аккаунт: прежнего сначала снимаем,
                                // иначе уникальный индекс отобьёт замену ошибкой.
                                if (p.account && p.account.id !== v) await detachPhone(projectId!, p.account.id);
                                if (v !== NONE) await attachPhone(projectId!, v, p.id);
                              },
                            )}
                          >
                            <SelectTrigger className="h-8 w-[13rem]"><SelectValue placeholder="Свободен" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>Свободен</SelectItem>
                              {p.account && (
                                <SelectItem value={p.account.id}>
                                  {p.account.account_name} ({p.account.platform})
                                </SelectItem>
                              )}
                              {free.map((a) => (
                                <SelectItem key={a.id} value={a.id}>{a.account_name} ({a.platform})</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          {p.warmup?.day
                            ? <WarmupBar day={p.warmup.day} ready={p.warmup.ready} />
                            : <span className="text-xs text-muted-foreground">—</span>}
                          {p.warmup?.lastState && (
                            <div className="mt-1 text-xs text-muted-foreground">{p.warmup.lastState}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1.5">
                            <Button
                              size="sm" variant="outline" disabled={rowBusy}
                              title={p.status === 4
                                ? "Открыть экран телефона"
                                : "Открыть окно телефона — включить можно прямо в нём"}
                              onClick={() => setScreenPhone(p)}
                            >
                              <MonitorSmartphone className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm" variant="outline" disabled={rowBusy || p.status === 3}
                              title={p.proxyIp ? undefined : "Без прокси телефон не включится — привяжите прокси в PhoneGrid"}
                              onClick={() => void act(p.id, p.status === 4 ? "Выключен" : "Включён",
                                () => setPhonePower(projectId!, p.id, p.status !== 4))}
                            >
                              {p.status === 4 ? "Выключить" : "Включить"}
                            </Button>
                            <Button
                              size="sm" disabled={rowBusy || !p.account || warmedToday(p)}
                              title={!p.account
                                ? "Сначала привяжите аккаунт — прогревают именно его, а не телефон"
                                : warmedToday(p)
                                  ? "Сегодня прогрев уже запускали: два прогона за день — двойная активность, ради которой прогрев и растягивают"
                                  : "Запустить сценарий прогрева на сегодня"}
                              onClick={() => void act(p.id, "Прогрев запущен", () => runWarmup(projectId!, p.account!.id))}
                            >
                              {warmedToday(p) ? "Прогрет сегодня" : "Прогреть"}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {shown.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                        Ничего не найдено
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            <p className="text-xs text-muted-foreground">
              Порядок для нового аккаунта: включить телефон → открыть его в PhoneGrid и
              зарегистрироваться в приложении руками → привязать аккаунт здесь → жать «Прогреть»
              каждый день до пятнадцатого. Одно устройство — один аккаунт: два аккаунта на одном
              телефоне площадка свяжет между собой по отпечатку. Прогрев запускается на выключенном
              телефоне — он включит его сам. Телефоны тарифицируются по минутам, гасите после работы.
            </p>
          </>
        )}
      </CardContent>

      {screenPhone && (
        <PhoneScreenDialog open phone={screenPhone} onClose={() => { setScreenPhone(null); void reload(); }} />
      )}
      {createOpen && projectId && (
        <CreateDeviceDialog
          open projectId={projectId}
          onClose={() => setCreateOpen(false)}
          onCreated={() => void reload()}
        />
      )}
    </Card>
  );
}
