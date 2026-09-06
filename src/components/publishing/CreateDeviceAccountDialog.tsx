/**
 * «Завести аккаунт» — карточка для аккаунта, который вы подняли на облачном телефоне.
 *
 * Аккаунт, залогиненный в приложении, платформе ещё неизвестен: токена площадки у него нет,
 * поэтому нет ни статистики, ни автопубликации. Эта карточка делает его видимым в сетке —
 * с телефоном, состоянием и днём прогрева, — а метрики включатся после подключения по API
 * (docs/AUTOPOST-ARCHITECTURE.md).
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createDeviceAccount, type DevicePhone } from "@/lib/accountDevices";

const PLATFORMS = [
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube" },
  { value: "threads", label: "Threads" },
];

export function CreateDeviceAccountDialog({
  open, phone, projectId, onClose, onCreated,
}: {
  open: boolean;
  phone: DevicePhone;
  projectId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [platform, setPlatform] = useState("instagram");
  const [handle, setHandle] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await createDeviceAccount(projectId, {
        phone_id: phone.id,
        platform,
        handle: handle.trim(),
        account_name: name.trim() || (handle.trim() ? `@${handle.trim().replace(/^@/, "")}` : ""),
      });
      toast.success("Аккаунт заведён — он появился в сетке");
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
          <DialogTitle>Аккаунт на телефоне {phone.name}</DialogTitle>
          <DialogDescription>
            Вы вошли в аккаунт на этом телефоне — заведите его карточку, чтобы он появился
            в сетке вместе с прогревом. Статистика и автопубликация включатся после подключения
            по API: платформа получит доступ к данным площадки.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Площадка</Label>
            <Select value={platform} onValueChange={setPlatform} disabled={busy}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PLATFORMS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="handle">@хэндл</Label>
            <Input
              id="handle" value={handle} disabled={busy}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="например, markvision.kz"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="name">Название</Label>
            <Input
              id="name" value={name} disabled={busy}
              onChange={(e) => setName(e.target.value)}
              placeholder="как показывать в сетке; пусто — возьмём @хэндл"
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Пароль от аккаунта платформе не нужен и не сохраняется: он остался на телефоне.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Отмена</Button>
          <Button onClick={() => void submit()} disabled={busy || (!handle.trim() && !name.trim())}>
            {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Завести аккаунт
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
