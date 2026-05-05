import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MessageCircle } from "lucide-react";
import type { WhatsAppConfig } from "@/types/crm";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  current: WhatsAppConfig;
  onConnect: (cfg: WhatsAppConfig) => void;
}

export function ConnectWhatsAppDialog({
  open,
  onOpenChange,
  current,
  onConnect,
}: Props) {
  const [phone, setPhone] = useState(current.phone ?? "");
  const [name, setName] = useState(current.displayName ?? "");

  const submit = () => {
    if (!phone.trim()) return;
    onConnect({
      connected: true,
      phone: phone.trim(),
      displayName: name.trim() || undefined,
      connectedAt: new Date().toISOString(),
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-success/15 text-success">
              <MessageCircle className="h-4 w-4" />
            </span>
            Подключить WhatsApp Business
          </DialogTitle>
          <DialogDescription>
            Все входящие заявки будут попадать в воронку и в раздел чатов.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="wa-phone">Номер WhatsApp Business</Label>
            <Input
              id="wa-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+7 700 000 00 00"
              maxLength={32}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="wa-name">Имя бизнеса (необязательно)</Label>
            <Input
              id="wa-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="MarkVision AI"
              maxLength={80}
            />
          </div>

          <div className="rounded-xl border border-border/60 bg-secondary/30 p-3 text-xs text-muted-foreground">
            После подключения вы получите QR-код для авторизации в WhatsApp
            Business API. Все диалоги будут синхронизированы с CRM.
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            onClick={submit}
            disabled={!phone.trim()}
            className="bg-gradient-primary text-primary-foreground"
          >
            Подключить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}