/**
 * Устройство аккаунта: облачный телефон и прогрев — в карточке аккаунта, без кабинета PhoneGrid.
 *
 * Телефон нужен, чтобы аккаунт завести и прогреть. Публикация идёт через официальные API
 * площадок и устройства не требует, поэтому после прогрева телефон гасится.
 * Пароли площадок здесь не спрашиваются: вход делает человек на самом телефоне.
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  attachPhone, detachPhone, deviceStatus, listPhones, runWarmup, setPhonePower,
  type DevicePhone, type DeviceStatus,
} from "@/lib/accountDevices";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import type { PublishAccount } from "@/lib/publishingClient";

const NONE = "__none";

/** Прогрев: 15 дней до готовности. Показываем полосу и подпись этапа. */
function WarmupProgress({ day, ready, note }: { day: number; ready: boolean; note: string }) {
  const pct = Math.min(100, Math.round((Math.min(day, 15) / 15) * 100));
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span>{ready ? "Прогрет" : `День ${day} из 15`}</span>
        <span className="text-muted-foreground">{pct}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${ready ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

export function AccountDeviceDialog({
  open, account, onClose,
}: {
  open: boolean;
  account: PublishAccount;
  onClose: () => void;
}) {
  const { activeId: projectId } = useProjectsStore();
  const [phones, setPhones] = useState<DevicePhone[] | null>(null);
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!projectId) return;
    setError(null);
    try {
      const [list, st] = await Promise.all([listPhones(projectId), deviceStatus(projectId, account.id)]);
      setPhones(list);
      setStatus(st);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [projectId, account.id]);

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    if (!projectId) return;
    setBusy(true);
    try {
      await fn();
      toast.success(label);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const linked = status?.phone ?? null;
  const phone = phones?.find((p) => p.id === linked?.id) ?? null;
  // Свободные телефоны плюс уже привязанный к этому аккаунту.
  const selectable = (phones ?? []).filter((p) => !p.account || p.account.id === account.id);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Устройство · {account.account_name}</DialogTitle>
          <DialogDescription>
            Облачный телефон нужен, чтобы завести аккаунт и прогреть его. Публикация идёт
            через официальный API площадки и телефона не требует — после работы его лучше выключить.
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Телефон</label>
            <Select
              value={linked?.id ?? NONE}
              disabled={busy || phones === null}
              onValueChange={(v) => void act(
                v === NONE ? "Телефон отвязан" : "Телефон привязан",
                () => (v === NONE ? detachPhone(projectId, account.id) : attachPhone(projectId, account.id, v)),
              )}
            >
              <SelectTrigger><SelectValue placeholder={phones === null ? "Загрузка…" : "Выберите телефон"} /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Без телефона</SelectItem>
                {selectable.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}{p.proxyIp ? ` · ${p.proxyIp}` : ""} — {p.statusText}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Одно устройство — один аккаунт: два аккаунта на одном телефоне площадка свяжет между собой.
            </p>
          </div>

          {phone && (
            <div className="flex items-center gap-2">
              <Badge variant={phone.status === 4 ? "default" : "secondary"}>{phone.statusText}</Badge>
              {phone.proxyIp && <Badge variant="outline">{phone.proxyIp}{phone.country ? ` · ${phone.country}` : ""}</Badge>}
              <Button
                size="sm" variant="outline" disabled={busy}
                onClick={() => void act(phone.status === 4 ? "Выключен" : "Включён",
                  // Питание зовётся по id телефона: аккаунт для него не нужен.
                  () => setPhonePower(projectId, phone.id, phone.status !== 4))}
              >
                {phone.status === 4 ? "Выключить" : "Включить"}
              </Button>
            </div>
          )}

          {status && (
            <div className="space-y-3 rounded-lg border p-3">
              <WarmupProgress day={status.warmup.plan.day} ready={status.warmup.plan.ready} note={status.warmup.plan.note} />
              <p className="text-xs text-muted-foreground">
                Сегодня: {status.warmup.plan.videos} видео, лайки {status.warmup.plan.like}%,
                подписки {status.warmup.plan.follow}%, комментарии {status.warmup.plan.comments}%
              </p>
              {status.warmup.lastState && (
                <p className="text-xs text-muted-foreground">Последний запуск: {status.warmup.lastState}</p>
              )}
              {!status.supported && (
                <p className="text-xs text-amber-600">
                  Для этой площадки сценарий прогрева пока не настроен — нужна версия приложения
                  из маркетплейса PhoneGrid.
                </p>
              )}
              <Button
                size="sm" disabled={busy || !linked || !status.supported}
                onClick={() => void act("Прогрев запущен", () => runWarmup(projectId, account.id))}
              >
                Прогреть сегодня
              </Button>
              {status.requirements?.version && (
                <p className="text-xs text-muted-foreground">
                  Требуется {status.requirements.app} {status.requirements.version}, язык {status.requirements.locale},
                  телефон выключен — прогрев включит его сам.
                </p>
              )}
              {status.history.length > 0 && (
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {status.history.slice(0, 3).map((h, i) => (
                    <li key={i}>
                      {(h.startedAt ?? "").slice(0, 16)} — {h.state}{h.error ? `: ${h.error}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Закрыть</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
