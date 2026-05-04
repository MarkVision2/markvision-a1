import { useState } from "react";
import { ChevronDown, Tag } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { LeadChannel, LeadStage, UtmTags } from "@/types/crm";
import { getLastTouch } from "@/hooks/useCrmStore";
import { cn } from "@/lib/utils";

interface NewLeadDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  stages: LeadStage[];
  onCreate: (input: {
    name: string;
    phone: string;
    email?: string;
    source: string;
    stageId: string;
    amount: number;
    aiScore: number;
    note?: string;
    utm?: UtmTags;
    channel?: LeadChannel;
  }) => void;
}

const SOURCES = [
  { value: "manual", label: "Вручную" },
  { value: "site", label: "Сайт" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "lead_form", label: "Лид-форма" },
  { value: "call", label: "Звонок" },
  { value: "ads", label: "Реклама" },
  { value: "referral", label: "Рекомендация" },
];
const CHANNELS: { id: LeadChannel; label: string }[] = [
  { id: "whatsapp", label: "WhatsApp" },
  { id: "telegram", label: "Telegram" },
  { id: "instagram", label: "Instagram" },
  { id: "phone", label: "Звонок" },
  { id: "web", label: "Сайт" },
];

export function NewLeadDialog({
  open,
  onOpenChange,
  stages,
  onCreate,
}: NewLeadDialogProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [source, setSource] = useState(SOURCES[0].value);
  const [stageId, setStageId] = useState(stages[0]?.id ?? "new");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [channel, setChannel] = useState<LeadChannel>("whatsapp");
  const lastTouch = getLastTouch();
  const [utmOpen, setUtmOpen] = useState(false);
  const [utmSource, setUtmSource] = useState(lastTouch?.utm?.source ?? "");
  const [utmMedium, setUtmMedium] = useState(lastTouch?.utm?.medium ?? "");
  const [utmCampaign, setUtmCampaign] = useState(lastTouch?.utm?.campaign ?? "");
  const [utmContent, setUtmContent] = useState(lastTouch?.utm?.content ?? "");
  const [utmTerm, setUtmTerm] = useState(lastTouch?.utm?.term ?? "");

  const reset = () => {
    setName("");
    setPhone("");
    setEmail("");
    setSource(SOURCES[0].value);
    setStageId(stages[0]?.id ?? "new");
    setAmount("");
    setNote("");
    setChannel("whatsapp");
    setUtmOpen(false);
  };

  const submit = () => {
    if (!name.trim() || !phone.trim()) return;
    const utm: UtmTags = {};
    if (utmSource.trim()) utm.source = utmSource.trim();
    if (utmMedium.trim()) utm.medium = utmMedium.trim();
    if (utmCampaign.trim()) utm.campaign = utmCampaign.trim();
    if (utmContent.trim()) utm.content = utmContent.trim();
    if (utmTerm.trim()) utm.term = utmTerm.trim();
    onCreate({
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim() || undefined,
      source,
      stageId,
      amount: Number(amount) || 0,
      aiScore: Math.floor(40 + Math.random() * 50),
      note: note.trim() || undefined,
      utm: Object.keys(utm).length ? utm : undefined,
      channel,
    });
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Новый лид</DialogTitle>
          <DialogDescription>
            Добавьте клиента в воронку. AI-скоринг будет рассчитан автоматически.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="lead-name">Имя</Label>
            <Input
              id="lead-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Иван Иванов"
              maxLength={100}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="lead-phone">Телефон</Label>
            <Input
              id="lead-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+7 700 000 00 00"
              maxLength={32}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="lead-email">Email (необязательно)</Label>
            <Input
              id="lead-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="client@example.com"
              maxLength={120}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Источник</Label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Канал</Label>
              <Select value={channel} onValueChange={(v) => setChannel(v as LeadChannel)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHANNELS.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Этап</Label>
              <Select value={stageId} onValueChange={setStageId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {stages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="lead-amount">Сумма, $</Label>
              <Input
                id="lead-amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="0"
                inputMode="numeric"
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="lead-note">Комментарий</Label>
            <Textarea
              id="lead-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Доп. инфо о запросе"
              rows={3}
              maxLength={500}
            />
          </div>

          {/* UTM section */}
          <div className="rounded-xl border border-border/60 bg-secondary/20">
            <button
              type="button"
              onClick={() => setUtmOpen((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm"
            >
              <span className="flex items-center gap-2 font-semibold">
                <Tag className="h-3.5 w-3.5 text-primary" />
                UTM-метки и источник трафика
                {lastTouch?.utm && (
                  <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                    авто
                  </span>
                )}
              </span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform",
                  utmOpen && "rotate-180",
                )}
              />
            </button>
            {utmOpen && (
              <div className="grid gap-2 px-3 pb-3">
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    value={utmSource}
                    onChange={(e) => setUtmSource(e.target.value)}
                    placeholder="utm_source"
                  />
                  <Input
                    value={utmMedium}
                    onChange={(e) => setUtmMedium(e.target.value)}
                    placeholder="utm_medium"
                  />
                </div>
                <Input
                  value={utmCampaign}
                  onChange={(e) => setUtmCampaign(e.target.value)}
                  placeholder="utm_campaign"
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    value={utmContent}
                    onChange={(e) => setUtmContent(e.target.value)}
                    placeholder="utm_content"
                  />
                  <Input
                    value={utmTerm}
                    onChange={(e) => setUtmTerm(e.target.value)}
                    placeholder="utm_term"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Если открыть CRM по ссылке с <code>?utm_*</code>, метки
                  подставятся автоматически.
                </p>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            onClick={submit}
            disabled={!name.trim() || !phone.trim()}
            className="bg-gradient-primary text-primary-foreground"
          >
            Создать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}