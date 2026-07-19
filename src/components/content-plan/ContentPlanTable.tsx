import { useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, FileText, Instagram, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  CONTENT_PLAN_CATEGORY_META,
  CONTENT_PLAN_STATUS_META,
  CONTENT_PLAN_TYPE_META,
  type ContentPlanItem,
} from "@/lib/contentPlan";
import { fmtKzt, fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";

const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

function formatWhen(iso: string | null) {
  if (!iso) return { day: "—", time: "" };
  const d = new Date(iso);
  const day = `${d.toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty", day: "numeric" })} ${
    MONTHS[Number(d.toLocaleDateString("en-US", { timeZone: "Asia/Almaty", month: "numeric" })) - 1]
  }`;
  const time = d.toLocaleTimeString("ru-RU", {
    timeZone: "Asia/Almaty",
    hour: "2-digit",
    minute: "2-digit",
  });
  return { day, time };
}

function DescriptionDialog({
  item,
  open,
  onOpenChange,
}: {
  item: ContentPlanItem | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  if (!item) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{item.title}</DialogTitle>
          <DialogDescription>Описание · хэштеги · промпты · комментарии</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <Block label="Описание" value={item.description} />
          <Block label="Хэштеги" value={item.hashtags} />
          <Block label="Промпты" value={item.prompts} />
          <Block label="Комментарии" value={item.commentsNotes} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Block({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="whitespace-pre-wrap rounded-xl border border-border/60 bg-background/50 p-3 text-foreground">
        {value?.trim() || "—"}
      </div>
    </div>
  );
}

function StatCell({
  label,
  value,
  emphasize,
  money,
}: {
  label: string;
  value: number;
  emphasize?: boolean;
  money?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-xl border px-2.5 py-2",
        emphasize
          ? "border-success/30 bg-success/5"
          : "border-border/50 bg-background/60",
      )}
    >
      <div className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 truncate text-base font-bold tabular-nums tracking-tight sm:text-lg">
        {money ? fmtKzt(value) : fmtNum(value)}
      </div>
    </div>
  );
}

export function ContentPlanTable({
  items,
  loading,
  onTogglePlatform,
  onAdopt,
}: {
  items: ContentPlanItem[];
  loading: boolean;
  onTogglePlatform?: (id: string, key: keyof ContentPlanItem["platforms"], value: boolean) => void;
  onAdopt?: (item: ContentPlanItem) => void;
}) {
  const [descItem, setDescItem] = useState<ContentPlanItem | null>(null);

  if (loading && items.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Загрузка контент-плана…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/70 px-6 py-16 text-center text-sm text-muted-foreground">
        Пока нет публикаций. Нажмите «Новая публикация» — загрузите медиа и сразу поставьте в автопостинг.
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {items.map((item) => {
          const when = formatWhen(item.scheduledAt || item.publishedAt);
          const typeMeta = CONTENT_PLAN_TYPE_META[item.contentType];
          const statusMeta = CONTENT_PLAN_STATUS_META[item.status];
          const catMeta = CONTENT_PLAN_CATEGORY_META[item.category];
          const detailPath = `/marketing/content-plan/${encodeURIComponent(item.id)}`;
          const f = item.funnel;

          return (
            <article
              key={item.id}
              className="rounded-2xl border border-border/60 bg-card/50 p-3 sm:p-4"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
                {/* Media + meta */}
                <div className="flex min-w-0 flex-1 gap-3">
                  {item.thumbnailUrl || item.mediaUrl ? (
                    <Link
                      to={detailPath}
                      className="h-20 w-14 shrink-0 overflow-hidden rounded-xl border border-border/60 bg-muted sm:h-24 sm:w-16"
                    >
                      <img
                        src={item.thumbnailUrl || item.mediaUrl || ""}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </Link>
                  ) : (
                    <div className="grid h-20 w-14 shrink-0 place-items-center rounded-xl border border-dashed border-border/60 text-muted-foreground sm:h-24 sm:w-16">
                      <Instagram className="h-5 w-5" />
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        <span className="mr-1">{typeMeta.emoji}</span>
                        {typeMeta.label}
                      </span>
                      <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold", statusMeta.cls)}>
                        {statusMeta.label}
                      </span>
                      <span className="text-[11px] text-muted-foreground">{catMeta.label}</span>
                    </div>

                    <Link
                      to={detailPath}
                      className="mt-1 block truncate text-base font-semibold text-foreground hover:text-primary hover:underline"
                    >
                      {item.title}
                    </Link>

                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        {when.day}
                        {when.time ? ` · ${when.time}` : ""}
                      </span>
                      {item.codeword && (
                        <span>
                          Код-слово:{" "}
                          <span className="font-mono uppercase text-foreground">{item.codeword}</span>
                        </span>
                      )}
                      {item.synthetic && (
                        <span className="text-amber-700">из Instagram</span>
                      )}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1"
                        onClick={() => setDescItem(item)}
                      >
                        <FileText className="h-3.5 w-3.5" />
                        Описание
                      </Button>
                      <Link
                        to={detailPath}
                        className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[11px] font-semibold text-primary hover:underline"
                      >
                        Карточка <ExternalLink className="h-3 w-3" />
                      </Link>
                      {item.synthetic && onAdopt && (
                        <button
                          type="button"
                          className="text-[11px] font-semibold text-primary hover:underline"
                          onClick={() => onAdopt(item)}
                        >
                          В план
                        </button>
                      )}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                      {(
                        [
                          ["instagram", "IG"],
                          ["facebook", "FB"],
                          ["threads", "Threads"],
                          ["telegram", "TG"],
                          ["linkedin", "LI"],
                        ] as const
                      ).map(([key, label]) => (
                        <label key={key} className="inline-flex items-center gap-1 text-muted-foreground">
                          <Switch
                            checked={item.platforms[key]}
                            disabled={!!item.synthetic || !onTogglePlatform}
                            onCheckedChange={(v) => onTogglePlatform?.(item.id, key, v)}
                            className="scale-75"
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Per-publication stats — primary signal */}
                <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 lg:w-[420px] lg:shrink-0 xl:w-[480px] xl:grid-cols-5">
                  <StatCell label="Охват" value={f.reach} />
                  <StatCell label="Код-слов" value={f.codewordHits} />
                  <StatCell label="Лиды" value={f.registrations} />
                  <StatCell label="Оплаты" value={f.paid} />
                  <StatCell label="Выручка" value={f.revenue} money emphasize />
                </div>
              </div>
            </article>
          );
        })}
      </div>
      <DescriptionDialog item={descItem} open={!!descItem} onOpenChange={(v) => !v && setDescItem(null)} />
    </>
  );
}
