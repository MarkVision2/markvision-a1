/**
 * Радар идей: диалог «Добавить источник» — площадка, тип (аккаунт / хештег /
 * Библиотека рекламы / свой аккаунт), ник или ссылка, подпись, интервал.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  PLATFORM_META, SOURCE_KIND_META, sourceHandleFromUrl, type RadarPlatform, type RadarSourceKind,
} from "@/lib/radarClient";

const PLATFORMS = Object.keys(PLATFORM_META) as RadarPlatform[];
const KINDS = Object.keys(SOURCE_KIND_META) as RadarSourceKind[];

export interface AddSourceInput {
  platform: RadarPlatform;
  kind: RadarSourceKind;
  handle: string;
  label: string | null;
  crawl_interval_hours: number;
}

interface AddSourceDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  busy: boolean;
  /** Предзаполнение (например, «В источники» из рейтинга авторов). */
  preset?: { platform: RadarPlatform; handle: string } | null;
  onSubmit: (input: AddSourceInput) => Promise<void>;
}

const HINT: Record<RadarSourceKind, string> = {
  competitor_account: "Аккаунт конкурента: соберём последние посты, посчитаем «обычно» автора и X-фактор каждого.",
  hashtag: "Хештег: посты по тегу — Instagram, TikTok, YouTube.",
  ad_library_query: "Поиск по Библиотеке рекламы Meta по всем странам; у объявлений нет реакций — оценка только по разбору.",
  own_account: "Свой аккаунт: лента ваших постов, чтобы банк идей учился на ваших результатах.",
};

export function AddSourceDialog({ open, onOpenChange, busy, preset, onSubmit }: AddSourceDialogProps) {
  const [platform, setPlatform] = useState<RadarPlatform>("instagram");
  const [kind, setKind] = useState<RadarSourceKind>("competitor_account");
  const [handle, setHandle] = useState("");
  const [label, setLabel] = useState("");
  const [interval, setInterval] = useState("24");

  useEffect(() => {
    if (open && preset) {
      setPlatform(preset.platform);
      setKind("competitor_account");
      setHandle(preset.handle);
    }
  }, [open, preset]);

  const isQuery = kind === "ad_library_query";
  const submit = async () => {
    const h = isQuery ? handle.trim() : sourceHandleFromUrl(handle);
    if (!h) {
      toast.error(isQuery ? "Укажите запрос для Библиотеки рекламы" : "Укажите ник или ссылку на аккаунт");
      return;
    }
    await onSubmit({
      platform, kind, handle: h, label: label.trim() || null,
      crawl_interval_hours: Math.min(Math.max(Number(interval) || 24, 1), 168),
    });
    setHandle("");
    setLabel("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Добавить источник</DialogTitle>
          <DialogDescription>{HINT[kind]}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="radar-src-platform">Площадка</Label>
              <Select value={platform} onValueChange={(v) => setPlatform(v as RadarPlatform)}>
                <SelectTrigger id="radar-src-platform"><SelectValue /></SelectTrigger>
                <SelectContent>{PLATFORMS.map((p) => <SelectItem key={p} value={p}>{PLATFORM_META[p].label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="radar-src-kind">Тип</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as RadarSourceKind)}>
                <SelectTrigger id="radar-src-kind"><SelectValue /></SelectTrigger>
                <SelectContent>{KINDS.map((k) => <SelectItem key={k} value={k}>{SOURCE_KIND_META[k].label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="radar-src-handle">{isQuery ? "Запрос или ссылка" : kind === "hashtag" ? "Хештег" : "Ник или ссылка"}</Label>
            <Input
              id="radar-src-handle"
              placeholder={isQuery ? "имплантация зубов — или ссылка на страницу / Ad Library" : kind === "hashtag" ? "#стоматология" : "@clinic или https://instagram.com/clinic"}
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              onBlur={() => setHandle((v) => (isQuery ? v.trim() : sourceHandleFromUrl(v)))}
            />
          </div>
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="radar-src-label">Подпись</Label>
              <Input id="radar-src-label" placeholder="Например, «Стоматология рядом»" value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="radar-src-interval">Интервал, ч</Label>
              <Input id="radar-src-interval" type="number" min={1} max={168} value={interval} onChange={(e) => setInterval(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Отмена</Button>
          <Button onClick={() => void submit()} disabled={busy} className="gap-1">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Добавить и собрать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
