import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ExternalLink, FolderOpen, ImageOff, Loader2, Megaphone, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { buildAdsLaunchUrl } from "@/lib/adLaunchBridge";
import { useContentFactoryGallery } from "@/hooks/useContentFactoryGallery";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  filterByCategory, GALLERY_CATEGORY_FILTERS, groupGalleryItems, type GalleryFilterCategory,
} from "@/lib/contentFactoryGalleryUtils";

interface Props {
  active?: boolean;
}

export function ContentFactoryGallery({ active = true }: Props) {
  const { items, loading, load, removeItems, projectId, needsMigration, lastError } =
    useContentFactoryGallery();
  const navigate = useNavigate();

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
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0;

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const toggleSelectAllVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) for (const id of visibleIds) next.delete(id);
      else for (const id of visibleIds) next.add(id);
      return next;
    });

  const toggleSession = (sessionId: string) =>
    setCollapsedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId); else next.add(sessionId);
      return next;
    });

  const handleBulkDelete = async () => {
    const ids = deleteMode === "all_visible" ? visibleIds : Array.from(selected);
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
      <p className="rounded-2xl border border-border/60 bg-card/60 px-5 py-8 text-center text-sm text-muted-foreground">
        Выберите проект в шапке — галерея привязана к проекту.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Все генерации сохраняются автоматически
          {items.length > 0 && <span className="ml-1 font-medium text-foreground">· {items.length} шт.</span>}
        </p>
        <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0 rounded-xl border-border/60" aria-label="Обновить" disabled={loading} onClick={() => void load()}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

      {needsMigration && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-200">
          Таблица галереи не развёрнута — креативы показываются из результатов генерации и кэша. Примените{" "}
          <code className="rounded bg-background/60 px-1">007_content_factory_gallery_brand.sql</code> в SQL Editor проекта szfgdruhlebfvcmlvxdk.
        </div>
      )}
      {lastError && !needsMigration && (
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">{lastError}</p>
      )}

      <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:overflow-visible sm:px-0">
        <div className="flex w-max min-w-full gap-1.5 sm:w-auto sm:flex-wrap">
          {GALLERY_CATEGORY_FILTERS.map((f) => {
            const realCount = f.id === "all" ? items.length : filterByCategory(items, f.id).length;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => { setCategory(f.id); setSelected(new Set()); }}
                className={cn(
                  "shrink-0 rounded-xl border px-3 py-2 text-xs font-medium transition sm:py-1.5",
                  category === f.id
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-border/60 bg-background text-muted-foreground hover:bg-secondary/40",
                )}
              >
                {f.label} <span className="opacity-60">{realCount}</span>
              </button>
            );
          })}
        </div>
      </div>

      {filtered.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-card/60 px-3 py-2 text-xs">
          <label className="flex cursor-pointer items-center gap-2 font-medium">
            <Checkbox checked={allVisibleSelected} onCheckedChange={() => toggleSelectAllVisible()} aria-label="Выбрать все" className="h-4 w-4" />
            Выбрать все
          </label>
          <span className="text-muted-foreground">Показано {filtered.length} из {items.length}</span>
          <div className="ml-auto flex items-center gap-2">
            {someSelected && (
              <Button type="button" variant="destructive" size="sm" className="h-8 gap-1.5 rounded-lg text-xs" onClick={() => setDeleteMode("selected")}>
                <Trash2 className="h-3.5 w-3.5" /> Удалить ({selected.size})
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 rounded-lg border-border/60 text-xs text-destructive hover:text-destructive" onClick={() => setDeleteMode("all_visible")}>
              <Trash2 className="h-3.5 w-3.5" /> Все ({filtered.length})
            </Button>
          </div>
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="grid h-40 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 bg-card/40 px-6 py-14 text-center">
          <ImageOff className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
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
        <div className="space-y-6">
          {dateGroups.map((dateGroup) => (
            <section key={dateGroup.dateKey}>
              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">{dateGroup.label}</h3>
                <span className="text-[11px] text-muted-foreground">· {dateGroup.itemCount} шт.</span>
              </div>

              <div className="space-y-3">
                {dateGroup.sessions.map((session) => {
                  const collapsed = collapsedSessions.has(session.sessionId);
                  const sessionTime = new Date(session.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
                  const categoryLabel =
                    session.category === "ads" ? "Реклама"
                      : session.category === "content" ? "Контент"
                        : session.category === "ai" ? "Нейрофото" : null;

                  return (
                    <div key={session.sessionId} className="overflow-hidden rounded-2xl border border-border/50 bg-card/40">
                      <button
                        type="button"
                        onClick={() => toggleSession(session.sessionId)}
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-secondary/30"
                      >
                        <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-foreground">{session.typeTitle ?? "Генерация"}</span>
                            {categoryLabel && (
                              <span className="rounded-md bg-secondary/70 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{categoryLabel}</span>
                            )}
                            <span className="text-[11px] text-muted-foreground">{sessionTime} · {session.items.length} шт.</span>
                          </div>
                        </div>
                        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", collapsed && "-rotate-90")} />
                      </button>

                      {!collapsed && (
                        <div className="grid grid-cols-2 gap-2 border-t border-border/40 p-2 sm:grid-cols-3 lg:grid-cols-4">
                          {session.items.map((item) => (
                            <GalleryCard
                              key={item.id}
                              item={item}
                              selected={selected.has(item.id)}
                              onToggleSelect={() => toggleSelect(item.id)}
                              onDelete={async () => {
                                try {
                                  await removeItems([item.id]);
                                  setSelected((prev) => { const next = new Set(prev); next.delete(item.id); return next; });
                                  toast.success("Удалено");
                                } catch (e) {
                                  toast.error(e instanceof Error ? e.message : "Ошибка");
                                }
                              }}
                              onLaunchAd={() => navigate(buildAdsLaunchUrl(item.image_url))}
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
            <AlertDialogTitle>{deleteMode === "all_visible" ? "Удалить все на экране?" : "Удалить выбранные?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteMode === "all_visible"
                ? `Будет удалено ${filtered.length} креативов${category !== "all" ? ` в категории «${GALLERY_CATEGORY_FILTERS.find((f) => f.id === category)?.label}»` : ""}. Отменить нельзя.`
                : `Будет удалено ${selected.size} креативов. Отменить нельзя.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => void handleBulkDelete()}>
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function GalleryCard({
  item, selected, onToggleSelect, onDelete, onLaunchAd,
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
  onLaunchAd: () => void;
}) {
  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-xl border bg-card transition",
        selected ? "border-primary/60 ring-2 ring-primary/30" : "border-border/60 hover:border-primary/30",
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
      {item.source && item.source !== "db" && (
        <span className="absolute right-2 top-2 z-10 rounded-md bg-black/50 px-1.5 py-0.5 text-[9px] font-medium text-white">
          {item.source === "results" ? "из генерации" : "кэш"}
        </span>
      )}

      <div className="relative aspect-square bg-secondary/40">
        <img src={item.image_url} alt={item.style_label ?? "Креатив"} className="h-full w-full object-cover" loading="lazy" />
        <div className="absolute inset-x-0 bottom-0 flex gap-1.5 bg-gradient-to-t from-black/70 to-transparent p-2 pt-8 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
          <Button size="sm" variant="secondary" className="h-8 flex-1 rounded-lg text-xs" asChild>
            <a href={item.image_url} target="_blank" rel="noreferrer"><ExternalLink className="mr-1 h-3.5 w-3.5" /> Открыть</a>
          </Button>
          <Button
            size="sm"
            className="h-8 flex-1 rounded-lg text-xs"
            onClick={() => onLaunchAd()}
            title="Открыть мастер запуска с этим креативом"
          >
            <Megaphone className="mr-1 h-3.5 w-3.5" /> В рекламу
          </Button>
          <Button size="sm" variant="destructive" className="h-8 rounded-lg px-2.5" onClick={() => void onDelete()}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {item.style_label && (
        <div className="truncate px-2.5 py-1.5 text-[11px] font-medium text-foreground/80" title={item.prompt_snapshot ?? undefined}>
          {item.style_label}
        </div>
      )}
    </article>
  );
}
