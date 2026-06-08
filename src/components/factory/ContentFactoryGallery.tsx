import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ExternalLink,
  FolderOpen,
  ImageOff,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useContentFactoryGallery } from "@/hooks/useContentFactoryGallery";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  filterByCategory,
  GALLERY_CATEGORY_FILTERS,
  groupGalleryItems,
  type GalleryFilterCategory,
} from "@/lib/contentFactoryGalleryUtils";

interface Props {
  active?: boolean;
}

export function ContentFactoryGallery({ active = true }: Props) {
  const { items, loading, load, removeItems, projectId, needsMigration, lastError } =
    useContentFactoryGallery();

  const [category, setCategory] = useState<GalleryFilterCategory>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsedSessions, setCollapsedSessions] = useState<Set<string>>(new Set());
  const [deleteMode, setDeleteMode] = useState<"selected" | "all_visible" | null>(null);

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  const filtered = useMemo(() => filterByCategory(items, category), [items, category]);
  const dateGroups = useMemo(() => groupGalleryItems(filtered), [filtered]);
  const visibleIds = useMemo(() => filtered.map((i) => i.id), [filtered]);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0;

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of visibleIds) next.delete(id);
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of visibleIds) next.add(id);
        return next;
      });
    }
  };

  const toggleSession = (sessionId: string) => {
    setCollapsedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    const ids =
      deleteMode === "all_visible" ? visibleIds : Array.from(selected);
    setDeleteMode(null);
    if (!ids.length) return;
    try {
      await removeItems(ids);
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      toast.success(`Удалено: ${ids.length}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка удаления");
    }
  };

  if (!projectId) {
    return (
      <p className="rounded-2xl border border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
        Выберите проект в шапке — галерея привязана к проекту.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Все генерации сохраняются автоматически — по сессиям, датам и типу контента.
          {items.length > 0 && (
            <span className="ml-1 font-medium text-foreground">
              ({items.length} {items.length === 1 ? "креатив" : "креативов"})
            </span>
          )}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-11 w-full gap-1.5 sm:h-8 sm:w-auto"
          disabled={loading}
          onClick={() => void load()}
        >
          <RefreshCw className={cn("h-4 w-4 sm:h-3.5 sm:w-3.5", loading && "animate-spin")} />
          Обновить
        </Button>
      </div>

      {needsMigration && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-900 dark:text-amber-100">
          Таблица галереи не развёрнута в Clony Supabase. Креативы показываются из результатов генерации и
          локального кэша. Примените миграцию{" "}
          <code className="rounded bg-background/60 px-1">007_content_factory_gallery_brand.sql</code>{" "}
          в SQL Editor проекта <code className="rounded bg-background/60 px-1">szfgdruhlebfvcmlvxdk</code>.
        </div>
      )}

      {lastError && !needsMigration && (
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {lastError}
        </p>
      )}

      {/* Category filters — горизонтальный скролл на телефоне */}
      <div className="-mx-3 overflow-x-auto px-3 scrollbar-none sm:mx-0 sm:overflow-visible sm:px-0">
        <div className="flex w-max min-w-full gap-2 sm:w-auto sm:flex-wrap">
          {GALLERY_CATEGORY_FILTERS.map((f) => {
            const realCount = f.id === "all" ? items.length : filterByCategory(items, f.id).length;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  setCategory(f.id);
                  setSelected(new Set());
                }}
                className={cn(
                  "shrink-0 rounded-xl border px-4 py-2.5 text-xs font-medium transition-all touch-manipulation",
                  "min-h-[44px] sm:min-h-0 sm:py-1.5 sm:px-3",
                  category === f.id
                    ? "border-primary bg-primary/10 text-primary shadow-glow"
                    : "border-border bg-card text-muted-foreground hover:border-primary/40",
                )}
              >
                {f.label}
                <span className="ml-1.5 opacity-70">({realCount})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Bulk actions */}
      {filtered.length > 0 && (
        <div className="space-y-2 rounded-xl border border-border bg-card/60 p-3 sm:flex sm:flex-wrap sm:items-center sm:gap-3 sm:space-y-0 sm:py-2">
          <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm font-medium sm:min-h-0 sm:gap-2 sm:text-xs">
            <Checkbox
              checked={allVisibleSelected}
              onCheckedChange={() => toggleSelectAllVisible()}
              aria-label="Выбрать все на экране"
              className="h-5 w-5"
            />
            Выбрать все ({filtered.length})
          </label>
          <div className="flex flex-col gap-2 sm:ml-auto sm:flex-row sm:items-center">
            {someSelected && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="h-11 gap-2 text-sm sm:h-7 sm:text-xs"
                onClick={() => setDeleteMode("selected")}
              >
                <Trash2 className="h-4 w-4 sm:h-3 sm:w-3" />
                Удалить выбранные ({selected.size})
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11 gap-2 text-sm text-destructive hover:text-destructive sm:h-7 sm:text-xs"
              onClick={() => setDeleteMode("all_visible")}
            >
              <Trash2 className="h-4 w-4 sm:h-3 sm:w-3" />
              Удалить все ({filtered.length})
            </Button>
          </div>
          <span className="text-center text-[11px] text-muted-foreground sm:ml-0 sm:text-left">
            Показано {filtered.length} из {items.length}
          </span>
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="grid h-40 place-items-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-14 text-center">
          <ImageOff className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
          <p className="text-sm font-medium text-foreground">
            {items.length === 0 ? "Пока нет готового контента" : "Нет креативов в этой категории"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {items.length === 0
              ? "Создайте креатив во вкладке «Создать» — каждая генерация сохранится сюда."
              : "Выберите другой фильтр или создайте новый контент."}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {dateGroups.map((dateGroup) => (
            <section key={dateGroup.dateKey}>
              <div className="mb-3 flex items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">{dateGroup.label}</h3>
                <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
                  {dateGroup.itemCount}{" "}
                  {dateGroup.itemCount === 1 ? "креатив" : "креативов"}
                </span>
              </div>

              <div className="space-y-4">
                {dateGroup.sessions.map((session) => {
                  const collapsed = collapsedSessions.has(session.sessionId);
                  const sessionTime = new Date(session.createdAt).toLocaleTimeString("ru-RU", {
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                  const categoryLabel =
                    session.category === "ads"
                      ? "Реклама"
                      : session.category === "content"
                        ? "Контент"
                        : session.category === "ai"
                          ? "Нейрофото"
                          : null;

                  return (
                    <div
                      key={session.sessionId}
                      className="overflow-hidden rounded-2xl border border-border bg-card/40"
                    >
                      <button
                        type="button"
                        onClick={() => toggleSession(session.sessionId)}
                        className="flex w-full min-h-[56px] items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-secondary/30 touch-manipulation sm:min-h-0 sm:py-3"
                      >
                        <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-foreground">
                              {session.typeTitle ?? "Генерация"}
                            </span>
                            {categoryLabel && (
                              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                                {categoryLabel}
                              </span>
                            )}
                            <span className="text-[11px] text-muted-foreground">{sessionTime}</span>
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            {session.items.length}{" "}
                            {session.items.length === 1 ? "вариант" : "вариантов"} в сессии
                          </p>
                        </div>
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                            collapsed && "-rotate-90",
                          )}
                        />
                      </button>

                      {!collapsed && (
                        <div className="grid grid-cols-1 gap-3 border-t border-border p-3 sm:grid-cols-2 lg:grid-cols-3">
                          {session.items.map((item) => (
                            <GalleryCard
                              key={item.id}
                              item={item}
                              selected={selected.has(item.id)}
                              onToggleSelect={() => toggleSelect(item.id)}
                              onDelete={async () => {
                                try {
                                  await removeItems([item.id]);
                                  setSelected((prev) => {
                                    const next = new Set(prev);
                                    next.delete(item.id);
                                    return next;
                                  });
                                  toast.success("Удалено");
                                } catch (e) {
                                  toast.error(e instanceof Error ? e.message : "Ошибка");
                                }
                              }}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <AlertDialog open={deleteMode !== null} onOpenChange={(o) => !o && setDeleteMode(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteMode === "all_visible" ? "Удалить все на экране?" : "Удалить выбранные?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteMode === "all_visible"
                ? `Будет удалено ${filtered.length} креативов${category !== "all" ? ` в категории «${GALLERY_CATEGORY_FILTERS.find((f) => f.id === category)?.label}»` : ""}. Это действие нельзя отменить.`
                : `Будет удалено ${selected.size} креативов. Это действие нельзя отменить.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void handleBulkDelete()}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function GalleryCard({
  item,
  selected,
  onToggleSelect,
  onDelete,
}: {
  item: {
    id: string;
    image_url: string;
    style_label: string | null;
    type_title: string | null;
    created_at: string;
    prompt_snapshot: string | null;
    source?: string;
  };
  selected: boolean;
  onToggleSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-xl border bg-card shadow-sm transition-all",
        selected ? "border-primary ring-2 ring-primary/40" : "border-border hover:shadow-md",
      )}
    >
      <div className="absolute left-2 top-2 z-10">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggleSelect}
          aria-label="Выбрать креатив"
          className="h-5 w-5 border-white/80 bg-black/40 data-[state=checked]:bg-primary"
        />
      </div>

      <div className="relative aspect-[4/5] bg-secondary/40 sm:aspect-square">
        <img
          src={item.image_url}
          alt={item.style_label ?? "Креатив"}
          className="h-full w-full object-contain sm:object-cover"
          loading="lazy"
        />
      </div>

      <div className="space-y-2 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {item.style_label && (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-foreground">
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
          <p className="line-clamp-2 text-[11px] text-foreground/70">{item.prompt_snapshot}</p>
        )}

        {/* Кнопки всегда видны на телефоне — hover на мобильном не работает */}
        <div className="flex gap-2 pt-1 sm:hidden">
          <Button size="sm" variant="secondary" className="h-11 min-h-[44px] flex-1" asChild>
            <a href={item.image_url} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-1.5 h-4 w-4" />
              Открыть
            </a>
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="h-11 min-h-[44px] min-w-[44px] px-3"
            onClick={() => void onDelete()}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 hidden bg-gradient-to-t from-black/70 to-transparent p-3 pt-10 opacity-0 transition-opacity group-hover:opacity-100 sm:block">
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" className="h-8 flex-1" asChild>
            <a href={item.image_url} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-1 h-3.5 w-3.5" />
              Открыть
            </a>
          </Button>
          <Button size="sm" variant="destructive" className="h-8" onClick={() => void onDelete()}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </article>
  );
}
