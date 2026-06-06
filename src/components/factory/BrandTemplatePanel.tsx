import { useState } from "react";
import { BookOpen, Loader2, Palette, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useBrandTemplates } from "@/hooks/useBrandTemplates";
import { BrandTemplateDialog } from "@/components/factory/BrandTemplateDialog";
import { Button } from "@/components/ui/button";

export function BrandTemplatePanel() {
  const { templates, loading, createTemplate, deleteTemplate, projectId } = useBrandTemplates();
  const [dialogOpen, setDialogOpen] = useState(false);

  if (!projectId) {
    return (
      <p className="rounded-2xl border border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
        Выберите проект — шаблоны бренда привязаны к проекту.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Шаблоны бренда</h2>
          <p className="text-xs text-muted-foreground">
            При создании креатива выберите шаблон — цвета, шрифты и референсы уйдут в n8n.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Создать свой шаблон
        </Button>
      </div>

      {loading ? (
        <div className="grid h-32 place-items-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : templates.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-12 text-center">
          <BookOpen className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
          <p className="text-sm font-medium">Нет шаблонов</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Загрузите брендбук, логотип, референсы и шрифты — AI будет генерировать в вашем стиле.
          </p>
          <Button className="mt-4 gap-2" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            Добавить брендбук
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {templates.map((t) => (
            <article key={t.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-start gap-3">
                {t.logo_url ? (
                  <img src={t.logo_url} alt="" className="h-12 w-12 rounded-lg border object-contain bg-white p-1" />
                ) : (
                  <span className="grid h-12 w-12 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Palette className="h-5 w-5" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate font-semibold">{t.name}</h3>
                    {t.is_default && (
                      <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                        По умолчанию
                      </span>
                    )}
                  </div>
                  {t.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{t.description}</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {[t.colors?.primary, t.colors?.secondary, t.colors?.accent]
                      .filter(Boolean)
                      .map((c, i) => (
                        <span
                          key={i}
                          className="h-4 w-4 rounded-full border border-border"
                          style={{ backgroundColor: c }}
                          title={c}
                        />
                      ))}
                    <span className="text-[10px] text-muted-foreground">
                      · реф. {t.reference_urls.length} · брендбук {t.brandbook_urls.length}
                    </span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={async () => {
                    try {
                      await deleteTemplate(t.id);
                      toast.success("Шаблон удалён");
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Ошибка");
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}

      <BrandTemplateDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSave={async (input) => {
          const created = await createTemplate(input);
          if (!created) throw new Error("Не удалось создать шаблон");
        }}
      />
    </div>
  );
}
