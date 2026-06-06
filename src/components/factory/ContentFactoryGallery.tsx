import { useEffect } from "react";
import { ExternalLink, ImageOff, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useContentFactoryGallery } from "@/hooks/useContentFactoryGallery";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  /** Вызывается при открытии вкладки — перезагрузить список */
  active?: boolean;
}

export function ContentFactoryGallery({ active = true }: Props) {
  const { items, loading, load, removeItem, projectId, needsMigration, lastError } =
    useContentFactoryGallery();

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  if (!projectId) {
    return (
      <p className="rounded-2xl border border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
        Выберите проект в шапке — галерея привязана к проекту.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Готовые креативы сохраняются автоматически после генерации.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          disabled={loading}
          onClick={() => void load()}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Обновить
        </Button>
      </div>

      {needsMigration && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-900 dark:text-amber-100">
          Таблица галереи не развёрнута на Supabase. Креативы показываются из результатов генерации и
          локального кэша. Примените миграцию{" "}
          <code className="rounded bg-background/60 px-1">20260606160000_content_factory_gallery_brand.sql</code>{" "}
          на проекте mekwfbqmsqiborjdrjxc.
        </div>
      )}

      {lastError && !needsMigration && (
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {lastError}
        </p>
      )}

      {loading && items.length === 0 ? (
        <div className="grid h-40 place-items-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-14 text-center">
          <ImageOff className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
          <p className="text-sm font-medium text-foreground">Пока нет готового контента</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Создайте креатив во вкладке «Создать» — готовые изображения сохранятся сюда автоматически.
            Если генерация уже идёт, нажмите «Обновить» через минуту.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <article
              key={item.id}
              className="group overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="relative aspect-square bg-secondary/40">
                <img
                  src={item.image_url}
                  alt={item.style_label ?? "Креатив"}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3 pt-10 opacity-0 transition-opacity group-hover:opacity-100">
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" className="h-8 flex-1" asChild>
                      <a href={item.image_url} target="_blank" rel="noreferrer">
                        <ExternalLink className="mr-1 h-3.5 w-3.5" />
                        Открыть
                      </a>
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-8"
                      onClick={async () => {
                        try {
                          await removeItem(item.id);
                          toast.success("Удалено из галереи");
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Ошибка удаления");
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
              <div className="space-y-1 p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {item.type_title && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                      {item.type_title}
                    </span>
                  )}
                  {item.style_label && (
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
                      {item.style_label}
                    </span>
                  )}
                  {item.source && item.source !== "db" && (
                    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                      {item.source === "results" ? "из генерации" : "кэш"}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {new Date(item.created_at).toLocaleString("ru-RU")}
                </p>
                {item.prompt_snapshot && (
                  <p className={cn("line-clamp-2 text-[11px] text-foreground/70")}>{item.prompt_snapshot}</p>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
