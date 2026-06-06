import { useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import type { BrandTemplateInput } from "@/hooks/useBrandTemplates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (input: BrandTemplateInput) => Promise<void>;
}

export function BrandTemplateDialog({ open, onOpenChange, onSave }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [primary, setPrimary] = useState("#2563eb");
  const [secondary, setSecondary] = useState("#1e293b");
  const [accent, setAccent] = useState("#f59e0b");
  const [fontHeading, setFontHeading] = useState("");
  const [fontBody, setFontBody] = useState("");
  const [tone, setTone] = useState("");
  const [styleNotes, setStyleNotes] = useState("");
  const [promptAddon, setPromptAddon] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [referenceFiles, setReferenceFiles] = useState<File[]>([]);
  const [brandbookFiles, setBrandbookFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setName("");
    setDescription("");
    setPrimary("#2563eb");
    setSecondary("#1e293b");
    setAccent("#f59e0b");
    setFontHeading("");
    setFontBody("");
    setTone("");
    setStyleNotes("");
    setPromptAddon("");
    setIsDefault(false);
    setLogoFile(null);
    setReferenceFiles([]);
    setBrandbookFiles([]);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Укажите название шаблона");
      return;
    }
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description,
        colors: { primary, secondary, accent },
        fonts: { heading: fontHeading, body: fontBody },
        tone,
        style_notes: styleNotes,
        prompt_addon: promptAddon,
        is_default: isDefault,
        logoFile,
        referenceFiles,
        brandbookFiles,
      });
      reset();
      onOpenChange(false);
      toast.success("Шаблон сохранён");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Создать шаблон бренда</DialogTitle>
          <DialogDescription>
            Логотип, цвета, шрифты и референсы уйдут в webhook при генерации креатива.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Название *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: Mir Bez Granits" />
          </div>
          <div className="space-y-2">
            <Label>Описание бренда</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Основной</Label>
              <Input type="color" value={primary} onChange={(e) => setPrimary(e.target.value)} className="h-10 p-1" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Вторичный</Label>
              <Input type="color" value={secondary} onChange={(e) => setSecondary(e.target.value)} className="h-10 p-1" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Акцент</Label>
              <Input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} className="h-10 p-1" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Шрифт заголовков</Label>
              <Input value={fontHeading} onChange={(e) => setFontHeading(e.target.value)} placeholder="Montserrat" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Шрифт текста</Label>
              <Input value={fontBody} onChange={(e) => setFontBody(e.target.value)} placeholder="Inter" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Тон коммуникации</Label>
            <Input value={tone} onChange={(e) => setTone(e.target.value)} placeholder="Премиум, дружелюбный, экспертный…" />
          </div>
          <div className="space-y-2">
            <Label>Стиль и визуал</Label>
            <Textarea value={styleNotes} onChange={(e) => setStyleNotes(e.target.value)} rows={2} placeholder="Минимализм, много воздуха, фото с людьми…" />
          </div>
          <div className="space-y-2">
            <Label>Доп. инструкции для AI</Label>
            <Textarea value={promptAddon} onChange={(e) => setPromptAddon(e.target.value)} rows={3} />
          </div>

          <div className="space-y-2">
            <Label>Логотип</Label>
            <Input type="file" accept="image/*" onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)} />
          </div>
          <div className="space-y-2">
            <Label>Референсы стиля (фото)</Label>
            <Input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setReferenceFiles(Array.from(e.target.files ?? []))}
            />
          </div>
          <div className="space-y-2">
            <Label>Брендбук (PDF, изображения)</Label>
            <Input
              type="file"
              accept="image/*,.pdf"
              multiple
              onChange={(e) => setBrandbookFiles(Array.from(e.target.files ?? []))}
            />
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
            <span className="text-sm">Шаблон по умолчанию для проекта</span>
            <Switch checked={isDefault} onCheckedChange={setIsDefault} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Сохранить шаблон
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
