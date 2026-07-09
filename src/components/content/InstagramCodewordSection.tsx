import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Camera, ExternalLink, MessageCircle, MousePointerClick, Settings2, UserCheck } from "lucide-react";
import { useInstagramCodewords, useCodewordStats } from "@/hooks/useInstagramOrganic";
import { fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";

export function InstagramCodewordSection() {
  const { items, loading } = useInstagramCodewords();
  const { stats } = useCodewordStats();

  const statsById = useMemo(() => {
    const map = new Map(stats.map((s) => [s.codewordId, s]));
    return map;
  }, [stats]);

  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Camera className="h-4 w-4 text-pink-500" /> Код-слова Instagram → DM → заявка
        </div>
        <Link
          to="/settings?tab=ig-organic"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          <Settings2 className="h-3.5 w-3.5" /> Настроить код-слова
        </Link>
      </div>

      {loading ? (
        <div className="py-8 text-center text-sm text-muted-foreground">Загрузка…</div>
      ) : items.length === 0 ? (
        <div className="grid place-items-center rounded-xl border border-dashed border-border/60 py-8 text-center">
          <Camera className="mb-2 h-5 w-5 text-muted-foreground/60" />
          <div className="text-sm text-muted-foreground">Код-слова ещё не настроены</div>
          <Link to="/settings?tab=ig-organic" className="mt-2 text-xs font-medium text-primary hover:underline">
            Добавить первое код-слово →
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((it) => {
            const s = statsById.get(it.id);
            return (
              <div key={it.id} className="rounded-xl border border-border/50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold">«{it.codeword}»</span>
                    {!it.active && (
                      <span className="rounded-md border border-border bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        выкл
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <MessageCircle className="h-3 w-3" /> DM: {fmtNum(s?.codewordDms ?? 0)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <MousePointerClick className="h-3 w-3" /> клики: {fmtNum(s?.linkClicks ?? 0)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <UserCheck className="h-3 w-3" /> заявки: {fmtNum(s?.leads ?? 0)}
                    </span>
                  </div>
                </div>

                <div className="mt-2 grid gap-1.5 text-xs sm:grid-cols-2">
                  <div className="min-w-0">
                    <span className="text-muted-foreground">Ответ на комментарий: </span>
                    <span className={cn(!it.replyText && "italic text-muted-foreground")}>
                      {it.replyText || "не задан"}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <span className="text-muted-foreground">Текст в Direct: </span>
                    <span className={cn(!it.dmText && "italic text-muted-foreground")}>
                      {it.dmText || "не задан"}
                    </span>
                  </div>
                </div>

                {it.targetUrl && (
                  <a
                    href={it.targetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                  >
                    {it.targetUrl} <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
