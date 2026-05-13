import { Camera, MessageCircle, MousePointerClick, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CodewordStat, InstagramOrganicFunnelData } from "@/hooks/useInstagramOrganic";

interface Props {
  funnel: InstagramOrganicFunnelData;
  topCodewords: CodewordStat[];
}

const fmtNum = (n: number) => Math.round(n).toLocaleString("ru-RU");

export function InstagramOrganicFunnel({ funnel, topCodewords }: Props) {
  const steps = [
    { id: "dm",     label: "Код-слово в DM",   icon: MessageCircle,     value: funnel.codewordDms, base: funnel.codewordDms },
    { id: "users",  label: "Уникальные люди",  icon: Camera,            value: funnel.uniqueUsers, base: funnel.codewordDms },
    { id: "click",  label: "Перешли по ссылке", icon: MousePointerClick, value: funnel.linkClicks,  base: funnel.codewordDms },
    { id: "lead",   label: "Оставили заявку",   icon: UserCheck,         value: funnel.leads,       base: funnel.codewordDms },
  ];

  if (funnel.codewordDms === 0 && funnel.leads === 0) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card/60 p-6 text-center text-sm text-muted-foreground">
        <Camera className="mx-auto mb-2 h-5 w-5 text-pink-500" />
        Пока нет органических событий из Instagram. Опубликуйте рилс с код-словом — события появятся здесь автоматически.
      </div>
    );
  }

  const topThree = topCodewords
    .slice()
    .sort((a, b) => b.codewordDms - a.codewordDms)
    .filter((c) => c.codewordDms > 0 || c.leads > 0)
    .slice(0, 3);

  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-5">
      <div className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-pink-500">
        <Camera className="h-3.5 w-3.5" />
        Воронка Instagram organic
      </div>

      <div className="space-y-3">
        {steps.map((s, i) => {
          const Icon = s.icon;
          const pct = s.base > 0 ? (s.value / s.base) * 100 : 0;
          return (
            <div key={s.id} className="grid grid-cols-[150px_1fr_80px] items-center gap-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Icon className="h-3.5 w-3.5" />
                {s.label}
              </div>
              <div className="relative h-9 overflow-hidden rounded-lg border border-border/40 bg-secondary/20">
                <div
                  className={cn(
                    "h-full bg-gradient-to-r",
                    i === 0 && "from-pink-500/40 to-pink-500/20",
                    i === 1 && "from-pink-500/35 to-pink-500/15",
                    i === 2 && "from-warning/35 to-warning/15",
                    i === 3 && "from-success/45 to-success/25",
                  )}
                  style={{ width: `${Math.max(pct, s.value > 0 ? 4 : 0)}%` }}
                />
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold tabular-nums">
                  {fmtNum(s.value)}
                </span>
              </div>
              <div className="text-right text-sm font-bold tabular-nums">
                {pct.toFixed(0)}%
              </div>
            </div>
          );
        })}
      </div>

      {topThree.length > 0 && (
        <div className="mt-5 border-t border-border/30 pt-4">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Топ код-слова
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {topThree.map((c) => (
              <div key={c.codewordId} className="flex items-center gap-3 rounded-xl border border-border/40 bg-secondary/20 p-3">
                {c.thumbnailUrl ? (
                  <img
                    src={c.thumbnailUrl}
                    alt={c.codeword}
                    className="h-12 w-12 rounded-lg object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-pink-500/10">
                    <Camera className="h-5 w-5 text-pink-500" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">«{c.codeword}»</div>
                  <div className="text-[11px] text-muted-foreground">
                    DM: {fmtNum(c.codewordDms)} · клики: {fmtNum(c.linkClicks)} · заявки: {fmtNum(c.leads)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
