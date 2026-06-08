import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  BookOpen,
  FileText,
  ImagePlus,
  Loader2,
  Palette,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { BrandTemplateInput } from '@/hooks/useBrandTemplates';
import type { BrandTemplate } from '@/lib/contentFactoryBrand';

const EMPTY_FORM: BrandTemplateInput = {
  name: '',
  description: '',
  colors: { primary: '#3B82F6', secondary: '#1E293B', accent: '#F59E0B' },
  fonts: { heading: 'Montserrat', body: 'Inter' },
  tone: '',
  style_notes: '',
  prompt_addon: '',
  is_default: false,
};

function isImageUrl(url: string): boolean {
  return /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url);
}

function fileNameFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    return decodeURIComponent(path.split('/').pop() || 'файл');
  } catch {
    return 'файл';
  }
}

interface UploadZoneProps {
  label: string;
  hint: string;
  accept: string;
  multiple?: boolean;
  icon: React.ReactNode;
  onPick: (files: FileList | null) => void;
  disabled?: boolean;
}

function UploadZone({ label, hint, accept, multiple, icon, onPick, disabled }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{label}</Label>
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'w-full rounded-xl border-2 border-dashed p-4 sm:p-5 text-left transition-colors',
          'border-border/60 bg-muted/20 hover:border-primary/40 hover:bg-primary/5',
          'disabled:opacity-50 disabled:pointer-events-none',
          'min-h-[88px] touch-manipulation',
        )}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">Нажмите или перетащите файлы</p>
            <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
          </div>
          <Upload className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
        </div>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          onPick(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

interface BrandTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: BrandTemplate | null;
  onSave: (input: BrandTemplateInput, files: BrandFiles) => Promise<void>;
}

export interface BrandFiles {
  logo?: File;
  references: File[];
  brandbook: File[];
}

export function BrandTemplateDialog({
  open,
  onOpenChange,
  editing,
  onSave,
}: BrandTemplateDialogProps) {
  const isEdit = Boolean(editing);
  const [form, setForm] = useState<BrandTemplateInput>(EMPTY_FORM);
  const [logoFile, setLogoFile] = useState<File | undefined>();
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [refFiles, setRefFiles] = useState<File[]>([]);
  const [brandbookFiles, setBrandbookFiles] = useState<File[]>([]);
  const [keepLogoUrl, setKeepLogoUrl] = useState<string | null>(null);
  const [keepRefs, setKeepRefs] = useState<string[]>([]);
  const [keepBrandbook, setKeepBrandbook] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const resetForm = useCallback(() => {
    setForm(EMPTY_FORM);
    setLogoFile(undefined);
    setLogoPreview(null);
    setRefFiles([]);
    setBrandbookFiles([]);
    setKeepLogoUrl(null);
    setKeepRefs([]);
    setKeepBrandbook([]);
  }, []);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        name: editing.name,
        description: editing.description ?? '',
        colors: editing.colors,
        fonts: editing.fonts,
        tone: editing.tone ?? '',
        style_notes: editing.style_notes ?? '',
        prompt_addon: editing.prompt_addon ?? '',
        is_default: editing.is_default,
      });
      setKeepLogoUrl(editing.logo_url);
      setKeepRefs([...editing.reference_urls]);
      setKeepBrandbook([...editing.brandbook_urls]);
      setLogoFile(undefined);
      setLogoPreview(null);
      setRefFiles([]);
      setBrandbookFiles([]);
    } else {
      resetForm();
    }
  }, [open, editing, resetForm]);

  const handleLogoPick = (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setLogoFile(f);
    setKeepLogoUrl(null);
    const reader = new FileReader();
    reader.onload = () => setLogoPreview(reader.result as string);
    reader.readAsDataURL(f);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const input: BrandTemplateInput = {
        ...form,
        name: form.name.trim(),
        logo_url: logoFile ? undefined : keepLogoUrl ?? undefined,
        reference_urls: keepRefs,
        brandbook_urls: keepBrandbook,
      };
      await onSave(input, {
        logo: logoFile,
        references: refFiles,
        brandbook: brandbookFiles,
      });
      resetForm();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const handleClose = (next: boolean) => {
    if (!next) resetForm();
    onOpenChange(next);
  };

  const totalRefs = keepRefs.length + refFiles.length;
  const totalBrandbook = keepBrandbook.length + brandbookFiles.length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[min(92vh,900px)] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg sm:text-xl">
            <Sparkles className="h-5 w-5 text-primary shrink-0" />
            {isEdit ? 'Редактировать шаблон' : 'Создать шаблон бренда'}
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            Все поля сохраняются в шаблоне и передаются в генерацию: логотип, цвета, шрифты, тон,
            стиль, брендбук и референсы.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Основное */}
          <section className="space-y-3 rounded-xl border border-border/50 bg-card/30 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Основное
            </h3>
            <div className="space-y-2">
              <Label htmlFor="bt-name">Название *</Label>
              <Input
                id="bt-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Например: Mir Bez Granits"
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bt-desc">Описание бренда</Label>
              <Textarea
                id="bt-desc"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
                placeholder="Кратко о бренде, ЦА, продукте..."
                className="resize-none"
              />
            </div>
          </section>

          {/* Цвета и шрифты */}
          <section className="space-y-3 rounded-xl border border-border/50 bg-card/30 p-4">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Palette className="h-3.5 w-3.5" />
              Цвета и шрифты
            </h3>
            <div className="grid grid-cols-3 gap-3">
              {(['primary', 'secondary', 'accent'] as const).map((key) => (
                <div key={key} className="space-y-1.5">
                  <Label className="text-xs capitalize">
                    {key === 'primary' ? 'Основной' : key === 'secondary' ? 'Вторичный' : 'Акцент'}
                  </Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={form.colors[key]}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          colors: { ...f.colors, [key]: e.target.value },
                        }))
                      }
                      className="h-11 w-full min-w-0 cursor-pointer rounded-lg border border-border bg-background"
                    />
                  </div>
                  <p className="text-[10px] font-mono text-muted-foreground truncate">
                    {form.colors[key]}
                  </p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div className="space-y-1.5">
                <Label className="text-xs">Шрифт заголовков</Label>
                <Input
                  value={form.fonts.heading}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, fonts: { ...f.fonts, heading: e.target.value } }))
                  }
                  className="h-10"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Шрифт текста</Label>
                <Input
                  value={form.fonts.body}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, fonts: { ...f.fonts, body: e.target.value } }))
                  }
                  className="h-10"
                />
              </div>
            </div>
          </section>

          {/* Стиль */}
          <section className="space-y-3 rounded-xl border border-border/50 bg-card/30 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Стиль и тон
            </h3>
            <div className="space-y-2">
              <Label htmlFor="bt-tone">Тон коммуникации</Label>
              <Input
                id="bt-tone"
                value={form.tone}
                onChange={(e) => setForm((f) => ({ ...f, tone: e.target.value }))}
                placeholder="Премиум, дружелюбный, экспертный..."
                className="h-10"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bt-style">Стиль и визуал</Label>
              <Textarea
                id="bt-style"
                value={form.style_notes}
                onChange={(e) => setForm((f) => ({ ...f, style_notes: e.target.value }))}
                rows={2}
                placeholder="Минимализм, много воздуха, фото с людьми..."
                className="resize-none"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bt-addon">Доп. инструкции для AI</Label>
              <Textarea
                id="bt-addon"
                value={form.prompt_addon}
                onChange={(e) => setForm((f) => ({ ...f, prompt_addon: e.target.value }))}
                rows={2}
                placeholder="Запреты, обязательные элементы, формулировки..."
                className="resize-none"
              />
            </div>
          </section>

          {/* Файлы */}
          <section className="space-y-4 rounded-xl border border-border/50 bg-card/30 p-4">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <ImagePlus className="h-3.5 w-3.5" />
              Логотип, референсы и брендбук
            </h3>

            {/* Logo */}
            <div className="space-y-2">
              <Label>Логотип</Label>
              {(logoPreview || keepLogoUrl) && (
                <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 p-3">
                  <img
                    src={logoPreview || keepLogoUrl!}
                    alt="Логотип"
                    className="h-14 w-14 rounded-lg object-contain bg-background border border-border/40"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {logoFile?.name || 'Текущий логотип'}
                    </p>
                    <p className="text-xs text-muted-foreground">Передаётся в image_urls</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0 h-9 w-9"
                    onClick={() => {
                      setLogoFile(undefined);
                      setLogoPreview(null);
                      setKeepLogoUrl(null);
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              )}
              {!logoPreview && !keepLogoUrl && (
                <UploadZone
                  label=""
                  hint="PNG, JPG, WebP, SVG — один файл"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  icon={<ImagePlus className="h-5 w-5" />}
                  onPick={handleLogoPick}
                  disabled={saving}
                />
              )}
              {(logoPreview || keepLogoUrl) && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full sm:w-auto"
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/png,image/jpeg,image/webp,image/svg+xml';
                    input.onchange = () => handleLogoPick(input.files);
                    input.click();
                  }}
                >
                  Заменить логотип
                </Button>
              )}
            </div>

            {/* References */}
            <UploadZone
              label={`Референсы (${totalRefs})`}
              hint="До 12 изображений — стиль, композиция, примеры креативов"
              accept="image/png,image/jpeg,image/webp"
              multiple
              icon={<Sparkles className="h-5 w-5" />}
              onPick={(files) => {
                if (!files?.length) return;
                setRefFiles((prev) => [...prev, ...Array.from(files)].slice(0, 12));
              }}
              disabled={saving}
            />
            {(keepRefs.length > 0 || refFiles.length > 0) && (
              <div className="flex flex-wrap gap-2">
                {keepRefs.map((url) => (
                  <div
                    key={url}
                    className="relative group rounded-lg border border-border/60 overflow-hidden w-16 h-16 sm:w-20 sm:h-20"
                  >
                    {isImageUrl(url) ? (
                      <img src={url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-muted text-[10px] p-1 text-center">
                        файл
                      </div>
                    )}
                    <button
                      type="button"
                      className="absolute top-0.5 right-0.5 h-6 w-6 rounded-full bg-black/70 flex items-center justify-center"
                      onClick={() => setKeepRefs((u) => u.filter((x) => x !== url))}
                    >
                      <X className="h-3 w-3 text-white" />
                    </button>
                  </div>
                ))}
                {refFiles.map((f, i) => (
                  <div
                    key={`new-ref-${i}`}
                    className="relative rounded-lg border border-primary/40 bg-primary/5 px-2 py-1.5 text-xs max-w-[140px]"
                  >
                    <span className="line-clamp-2">{f.name}</span>
                    <button
                      type="button"
                      className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive flex items-center justify-center"
                      onClick={() => setRefFiles((arr) => arr.filter((_, j) => j !== i))}
                    >
                      <X className="h-3 w-3 text-white" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Brandbook */}
            <UploadZone
              label={`Брендбук (${totalBrandbook})`}
              hint="PDF или изображения — гайдлайны, палитра, типографика"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              multiple
              icon={<BookOpen className="h-5 w-5" />}
              onPick={(files) => {
                if (!files?.length) return;
                setBrandbookFiles((prev) => [...prev, ...Array.from(files)].slice(0, 8));
              }}
              disabled={saving}
            />
            {(keepBrandbook.length > 0 || brandbookFiles.length > 0) && (
              <div className="space-y-1.5">
                {keepBrandbook.map((url) => (
                  <div
                    key={url}
                    className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm"
                  >
                    {isImageUrl(url) ? (
                      <img src={url} alt="" className="h-8 w-8 rounded object-cover shrink-0" />
                    ) : (
                      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-xs sm:text-sm">
                      {fileNameFromUrl(url)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setKeepBrandbook((u) => u.filter((x) => x !== url))}
                      className="shrink-0 p-1"
                    >
                      <X className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                    </button>
                  </div>
                ))}
                {brandbookFiles.map((f, i) => (
                  <div
                    key={`new-bb-${i}`}
                    className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm"
                  >
                    <FileText className="h-4 w-4 text-primary shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-xs sm:text-sm">{f.name}</span>
                    <button
                      type="button"
                      onClick={() => setBrandbookFiles((arr) => arr.filter((_, j) => j !== i))}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Default */}
          <div className="flex items-center justify-between gap-4 rounded-xl border border-border/50 bg-card/30 p-4">
            <div className="min-w-0">
              <Label htmlFor="bt-default" className="text-sm font-medium">
                Шаблон по умолчанию
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Автоматически подставляется при создании креатива
              </p>
            </div>
            <Switch
              id="bt-default"
              checked={form.is_default}
              onCheckedChange={(v) => setForm((f) => ({ ...f, is_default: v }))}
            />
          </div>
        </div>

        <DialogFooter className="flex-col-reverse sm:flex-row gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => handleClose(false)}
            disabled={saving}
            className="w-full sm:w-auto min-h-[44px]"
          >
            Отмена
          </Button>
          <Button
            onClick={handleSave}
            disabled={!form.name.trim() || saving}
            className="w-full sm:w-auto min-h-[44px]"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Сохранение…
              </>
            ) : isEdit ? (
              'Сохранить изменения'
            ) : (
              'Создать шаблон'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
