import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useBrandTemplates, type BrandTemplateInput } from '@/hooks/useBrandTemplates';
import type { BrandTemplate } from '@/lib/contentFactoryBrand';
import { BrandTemplateDialog, type BrandFiles } from './BrandTemplateDialog';
import { Plus, Trash2, Star, Pencil, Palette, BookOpen, ImageIcon } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function BrandTemplatePanel() {
  const {
    templates,
    loading,
    isConfigured,
    createTemplate,
    updateTemplate,
    deleteTemplate,
  } = useBrandTemplates();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BrandTemplate | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (t: BrandTemplate) => {
    setEditing(t);
    setDialogOpen(true);
  };

  const handleSave = async (input: BrandTemplateInput, files: BrandFiles) => {
    const payload: BrandTemplateInput = {
      ...input,
      logoFile: files.logo,
      referenceFiles: files.references,
      brandbookFiles: files.brandbook,
    };
    try {
      if (editing) {
        await updateTemplate(editing.id, payload);
        toast.success('Шаблон обновлён — все настройки сохранены');
      } else {
        await createTemplate(payload);
        toast.success('Шаблон бренда создан');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ошибка сохранения';
      toast.error(msg);
      throw e;
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteTemplate(deleteId);
      toast.success('Шаблон удалён');
    } catch {
      toast.error('Не удалось удалить шаблон');
    } finally {
      setDeleteId(null);
    }
  };

  if (!isConfigured) {
    return (
      <Card className="border-dashed border-amber-500/40 bg-amber-500/5">
        <CardContent className="py-10 text-center space-y-2">
          <Palette className="h-10 w-10 mx-auto text-amber-500/80" />
          <p className="font-medium">Хранилище шаблонов не настроено</p>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Подключите Supabase (Clony) в настройках проекта — без этого шаблоны не сохраняются.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2].map((i) => (
          <Skeleton key={i} className="h-44 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold sm:text-xl">Шаблоны бренда</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground sm:text-sm">
            Цвета, шрифты, логотип и брендбук строго передаются в каждую генерацию
          </p>
        </div>
        <Button onClick={openCreate} className="hidden w-full min-h-[48px] shrink-0 sm:inline-flex sm:w-auto sm:min-h-[44px]">
          <Plus className="h-4 w-4 mr-2" />
          Создать шаблон
        </Button>
      </div>

      {templates.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center space-y-3">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
              <Palette className="h-7 w-7 text-primary" />
            </div>
            <p className="font-medium">Пока нет шаблонов</p>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              Загрузите логотип, брендбук и задайте цвета — AI будет соблюдать стиль бренда
            </p>
            <Button variant="outline" onClick={openCreate} className="min-h-[44px]">
              <Plus className="h-4 w-4 mr-2" />
              Первый шаблон
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          {templates.map((t) => (
            <Card
              key={t.id}
              className={cn(
                'overflow-hidden transition-shadow active:scale-[0.99] touch-manipulation',
                'hover:shadow-md',
                t.is_default && 'ring-2 ring-primary/30',
              )}
            >
              <CardContent className="p-0">
                <div className="flex h-2.5 sm:h-2">
                  <div className="flex-1" style={{ backgroundColor: t.colors.primary }} />
                  <div className="flex-1" style={{ backgroundColor: t.colors.secondary }} />
                  <div className="flex-1" style={{ backgroundColor: t.colors.accent }} />
                </div>

                <div className="space-y-3 p-4">
                  <div className="flex items-center gap-3">
                    {t.logo_url ? (
                      <img
                        src={t.logo_url}
                        alt=""
                        className="h-14 w-14 rounded-xl object-contain border border-border/50 bg-muted/30 shrink-0 sm:h-12 sm:w-12 sm:rounded-lg"
                      />
                    ) : (
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-muted sm:h-12 sm:w-12 sm:rounded-lg">
                        <Palette className="h-6 w-6 text-muted-foreground sm:h-5 sm:w-5" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold leading-tight sm:text-sm sm:font-semibold">{t.name}</h3>
                        {t.is_default && (
                          <Badge variant="secondary" className="shrink-0 gap-1 text-[10px]">
                            <Star className="h-3 w-3 fill-current" />
                            По умолчанию
                          </Badge>
                        )}
                      </div>
                      {t.description && (
                        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                          {t.description}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1 rounded-lg bg-muted/50 px-2.5 py-1">
                      <ImageIcon className="h-3.5 w-3.5" />
                      {t.reference_urls.length} реф.
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-lg bg-muted/50 px-2.5 py-1">
                      <BookOpen className="h-3.5 w-3.5" />
                      {t.brandbook_urls.length} брендбук
                    </span>
                    {t.tone && (
                      <span className="max-w-full truncate rounded-lg bg-muted/50 px-2.5 py-1 sm:max-w-[120px]">
                        {t.tone}
                      </span>
                    )}
                  </div>

                  <div className="flex gap-2 pt-0.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-[48px] flex-1 text-sm sm:min-h-[40px] sm:text-xs"
                      onClick={() => openEdit(t)}
                    >
                      <Pencil className="mr-2 h-4 w-4 sm:mr-1.5 sm:h-3.5 sm:w-3.5" />
                      Изменить
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-[48px] min-w-[48px] px-0 text-destructive hover:text-destructive sm:min-h-[40px] sm:min-w-[40px]"
                      onClick={() => setDeleteId(t.id)}
                      aria-label="Удалить шаблон"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Плавающая кнопка создания на телефоне */}
      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] z-40 px-4 pb-2 sm:hidden">
        <Button onClick={openCreate} className="h-12 w-full shadow-lg">
          <Plus className="mr-2 h-5 w-5" />
          Создать шаблон
        </Button>
      </div>
      <div className="h-14 sm:hidden" aria-hidden />

      <BrandTemplateDialog
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) setEditing(null);
        }}
        editing={editing}
        onSave={handleSave}
      />

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить шаблон?</AlertDialogTitle>
            <AlertDialogDescription>
              Шаблон исчезнет из списка. Уже сгенерированные креативы не изменятся.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
