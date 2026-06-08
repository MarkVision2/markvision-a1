import { ArrowRight, Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ContentType } from "@/data/contentTypes";

interface ContentTypeCardProps {
  type: ContentType;
  selected: boolean;
  onSelect: (id: string) => void;
}

const GLOW_BY_ID: Record<string, string> = {
  "facebook-ads": "from-blue-500/20 to-blue-600/5",
  "google-ads": "from-red-500/15 to-red-600/5",
  marketplace: "from-purple-500/15 to-purple-600/5",
  "insta-carousel": "from-pink-500/15 to-pink-600/5",
  "reels-cover": "from-violet-500/15 to-violet-600/5",
  stories: "from-orange-500/15 to-orange-600/5",
  "youtube-thumb": "from-red-500/20 to-red-600/5",
  "web-banner": "from-cyan-500/15 to-cyan-600/5",
  "neuro-photo": "from-primary/25 to-primary/5",
};

const ACCENT_BORDER: Record<string, string> = {
  ads: "border-l-blue-500/70",
  content: "border-l-violet-500/70",
  ai: "border-l-primary/80",
};

const ContentTypeCard = ({ type, selected, onSelect }: ContentTypeCardProps) => {
  const Icon = type.icon;
  const isAi = type.category === "ai";
  const gradient = GLOW_BY_ID[type.id] ?? "from-primary/15 to-transparent";

  return (
    <button
      type="button"
      onClick={() => onSelect(type.id)}
      aria-pressed={selected}
      aria-label={`${type.title} — ${type.subtitle}`}
      className={cn(
        "group relative flex w-full min-h-[80px] touch-manipulation items-center gap-3 rounded-2xl border border-border/50 bg-card/70 p-4 text-left",
        "border-l-[4px] transition active:scale-[0.98] sm:min-h-0 sm:flex-col sm:items-stretch sm:gap-0 sm:p-5",
        ACCENT_BORDER[type.category],
        "hover:border-primary/40 hover:bg-card hover:shadow-md",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected && "border-primary/50 bg-primary/5 ring-1 ring-primary/30 shadow-md",
      )}
    >
      <div className={cn("relative shrink-0", "h-14 w-14 sm:mb-4 sm:h-16 sm:w-16")}>
        <div
          aria-hidden
          className={cn(
            "absolute inset-0 rounded-2xl bg-gradient-to-br opacity-80 blur-md transition",
            gradient,
          )}
        />
        <div
          className={cn(
            "relative grid h-full w-full place-items-center rounded-xl border border-border/60 bg-background/90",
            (selected || isAi) && "border-primary/40",
          )}
        >
          <Icon
            className={cn(
              "h-6 w-6 sm:h-7 sm:w-7",
              isAi || selected ? "text-primary" : "text-foreground",
            )}
            strokeWidth={1.75}
          />
        </div>
      </div>

      <div className="min-w-0 flex-1 sm:pr-8">
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <h3 className="text-[15px] font-bold leading-snug text-foreground group-hover:text-primary sm:text-base">
            {type.title}
          </h3>
          {type.popular && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-warning/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-warning sm:px-2 sm:text-[10px]">
              <Flame className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
              Топ
            </span>
          )}
          {isAi && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary sm:px-2 sm:text-[10px]">
              AI
            </span>
          )}
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground sm:text-xs">{type.subtitle}</p>
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground/75 sm:mt-2 sm:line-clamp-2">
          {type.tooltip}
        </p>
      </div>

      <div
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/50 bg-background/80 transition",
          "group-hover:border-primary/30 group-hover:bg-primary/10",
          selected && "border-primary/40 bg-primary/10",
          "sm:absolute sm:right-4 sm:top-4 sm:h-auto sm:w-auto sm:rounded-none sm:border-0 sm:bg-transparent",
        )}
      >
        <ArrowRight
          className={cn(
            "h-4 w-4 text-muted-foreground/50 transition group-hover:text-primary",
            selected && "text-primary",
          )}
        />
      </div>
    </button>
  );
};

export default ContentTypeCard;
