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
import { fmtNum } from "@/lib/format";
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
        Пока нет публикаций. Добавьте идею или запланируйте пост во вкладке «Автопостинг».
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-2xl border border-border/60">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-3 font-semibold">Дата</th>
              <th className="px-3 py-3 font-semibold">Тип</th>
              <th className="px-3 py-3 font-semibold">Статус</th>
              <th className="px-3 py-3 font-semibold">Название</th>
              <th className="px-3 py-3 font-semibold">Категория</th>
              <th className="px-3 py-3 font-semibold">Описание</th>
              <th className="px-3 py-3 font-semibold">Медиа</th>
              <th className="px-3 py-3 font-semibold">Автопостинг</th>
              <th className="px-3 py-3 font-semibold text-right">Воронка</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const when = formatWhen(item.scheduledAt || item.publishedAt);
              const typeMeta = CONTENT_PLAN_TYPE_META[item.contentType];
              const statusMeta = CONTENT_PLAN_STATUS_META[item.status];
              const catMeta = CONTENT_PLAN_CATEGORY_META[item.category];
              const detailPath = `/marketing/content-plan/${encodeURIComponent(item.id)}`;
              return (
                <tr key={item.id} className="border-t border-border/50 hover:bg-muted/20">
                  <td className="px-3 py-3 align-top">
                    <div className="font-medium">{when.day}</div>
                    <div className="text-xs text-muted-foreground">{when.time}</div>
                  </td>
                  <td className="px-3 py-3 align-top whitespace-nowrap">
                    <span className="mr-1">{typeMeta.emoji}</span>
                    {typeMeta.label}
                  </td>
                  <td className="px-3 py-3 align-top">
                    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold", statusMeta.cls)}>
                      {statusMeta.label}
                    </span>
                  </td>
                  <td className="px-3 py-3 align-top max-w-[220px]">
                    <Link to={detailPath} className="font-semibold text-foreground hover:text-primary hover:underline">
                      {item.title}
                    </Link>
                    {item.codeword && (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        Код-слово: <span className="font-mono uppercase text-foreground">{item.codeword}</span>
                      </div>
                    )}
                    {item.synthetic && (
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-[10px] text-amber-700">из Instagram</span>
                        {onAdopt && (
                          <button
                            type="button"
                            className="text-[10px] font-semibold text-primary hover:underline"
                            onClick={() => onAdopt(item)}
                          >
                            В план
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 align-top text-muted-foreground">{catMeta.label}</td>
                  <td className="px-3 py-3 align-top">
                    <Button variant="outline" size="sm" className="h-8 gap-1" onClick={() => setDescItem(item)}>
                      <FileText className="h-3.5 w-3.5" />
                      Открыть
                    </Button>
                  </td>
                  <td className="px-3 py-3 align-top">
                    {item.thumbnailUrl || item.mediaUrl ? (
                      <Link to={detailPath} className="block h-14 w-10 overflow-hidden rounded-md border border-border/60 bg-muted">
                        <img
                          src={item.thumbnailUrl || item.mediaUrl || ""}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      </Link>
                    ) : (
                      <div className="grid h-14 w-10 place-items-center rounded-md border border-dashed border-border/60 text-muted-foreground">
                        <Instagram className="h-4 w-4" />
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 align-top">
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
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
                  </td>
                  <td className="px-3 py-3 align-top text-right">
                    <div className="tabular-nums text-xs text-muted-foreground">
                      <div>охват {fmtNum(item.funnel.reach)}</div>
                      <div>код {fmtNum(item.funnel.codewordHits)}</div>
                      <div>лиды {fmtNum(item.funnel.registrations)}</div>
                      <div>оплаты {fmtNum(item.funnel.paid)}</div>
                    </div>
                    <Link
                      to={detailPath}
                      className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                    >
                      Открыть <ExternalLink className="h-3 w-3" />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <DescriptionDialog item={descItem} open={!!descItem} onOpenChange={(v) => !v && setDescItem(null)} />
    </>
  );
}
