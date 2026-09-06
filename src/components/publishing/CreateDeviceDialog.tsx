/**
 * Создание облачных телефонов и добавление прокси — из интерфейса, без кабинета PhoneGrid.
 *
 * Создание устройства **платное**: телефон начинает тарифицироваться сразу, поэтому форма
 * прямо про это говорит, а кнопка называет количество. Прокси нужен обязательно — без него
 * телефон создастся, но не включится.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { addProxy, createPhones, deviceOptions, type DeviceOptions } from "@/lib/accountDevices";

const NONE = "__none";

export function CreateDeviceDialog({
  open, projectId, onClose, onCreated,
}: {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [opts, setOpts] = useState<DeviceOptions | null>(null);
  const [skuId, setSkuId] = useState("10005");
  const [quantity, setQuantity] = useState("1");
  const [proxyId, setProxyId] = useState(NONE);
  const [groupId, setGroupId] = useState(NONE);
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Добавление прокси прямо здесь: без него новый телефон не включится.
  const [proxyUrl, setProxyUrl] = useState("");
  const [proxyRefresh, setProxyRefresh] = useState("");
  const [showProxyForm, setShowProxyForm] = useState(false);

  const loadOptions = async () => {
    setError(null);
    try {
      const o = await deviceOptions(projectId);
      setOpts(o);
      if (o.proxies.length === 1) setProxyId(o.proxies[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    if (open) void loadOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId]);

  const qty = Math.min(Math.max(Number(quantity) || 1, 1), 10);

  const submitProxy = async () => {
    setBusy(true);
    try {
      await addProxy(projectId, proxyUrl.trim(), undefined, proxyRefresh.trim() || undefined);
      toast.success("Прокси добавлен");
      setProxyUrl("");
      setProxyRefresh("");
      setShowProxyForm(false);
      await loadOptions();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      const r = await createPhones(projectId, {
        sku_id: skuId,
        quantity: qty,
        remark: remark.trim(),
        proxy_id: proxyId === NONE ? null : proxyId,
        group_id: groupId === NONE ? null : groupId,
      });
      toast.success(`Создано устройств: ${r.created?.length ?? qty}`);
      onCreated();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Новое устройство</DialogTitle>
          <DialogDescription>
            Облачный телефон для заведения и прогрева аккаунта. Тарифицируется по минутам
            с момента создания — берите столько, сколько заведёте аккаунтов.
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {opts === null ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Загружаем варианты…
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Модель</Label>
                <Select value={skuId} onValueChange={setSkuId} disabled={busy}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {opts.models.map((m) => <SelectItem key={m.skuId} value={m.skuId}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="qty">Сколько</Label>
                <Input
                  id="qty" type="number" min={1} max={10} value={quantity} disabled={busy}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Прокси</Label>
              <Select value={proxyId} onValueChange={setProxyId} disabled={busy}>
                <SelectTrigger><SelectValue placeholder="Выберите прокси" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Без прокси</SelectItem>
                  {opts.proxies.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}{p.country ? ` · ${p.country}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {proxyId === NONE && (
                <p className="text-xs text-amber-600">
                  Без прокси телефон создастся, но не включится — площадка увидит серверный адрес.
                </p>
              )}
              {!showProxyForm ? (
                <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setShowProxyForm(true)}>
                  Добавить прокси
                </Button>
              ) : (
                <div className="space-y-2 rounded-md border p-2">
                  <Input
                    value={proxyUrl} disabled={busy}
                    onChange={(e) => setProxyUrl(e.target.value)}
                    placeholder="socks5://логин:пароль@хост:порт"
                  />
                  <Input
                    value={proxyRefresh} disabled={busy}
                    onChange={(e) => setProxyRefresh(e.target.value)}
                    placeholder="Ссылка смены IP (если есть)"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" disabled={busy || !proxyUrl.trim()} onClick={() => void submitProxy()}>
                      Сохранить прокси
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => setShowProxyForm(false)}>
                      Отмена
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Группа</Label>
              <Select value={groupId} onValueChange={setGroupId} disabled={busy}>
                <SelectTrigger><SelectValue placeholder="Без группы" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Без группы</SelectItem>
                  {opts.groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="remark">Примечание</Label>
              <Input
                id="remark" value={remark} disabled={busy}
                onChange={(e) => setRemark(e.target.value)}
                placeholder="Например: Instagram №3 — салон"
              />
            </div>

            <p className="text-xs text-muted-foreground">
              Страна, часовой пояс и язык подберутся по прокси автоматически.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Отмена</Button>
          <Button onClick={() => void submit()} disabled={busy || opts === null}>
            {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Создать {qty > 1 ? `${qty} устройства` : "устройство"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
