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
  ads: "border-l-blue-500/60",
  content: "border-l-violet-500/60",
  ai: "border-l-primary/70",
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
      title={type.tooltip}
      className={cn(
        "group relative flex w-full touch-manipulation flex-col rounded-2xl border border-border/50 bg-card/60 p-4 text-left sm:p-5",
        "border-l-[3px] transition active:scale-[0.98]",
        ACCENT_BORDER[type.category],
        "hover:border-primary/40 hover:bg-card/90 hover:shadow-lg",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected && "border-primary/50 bg-primary/5 ring-1 ring-primary/30",
      )}
    >
      <div className="flex items-start gap-3 sm:block">
        <div className={cn("relative shrink-0 sm:mb-4", "h-12 w-12 sm:h-14 sm:w-14")}>
          <div
            aria-hidden
            className={cn(
              "absolute inset-0 rounded-2xl bg-gradient-to-br opacity-80 blur-md transition",
              gradient,
            )}
          />
          <div
            className={cn(
              "relative grid h-full w-full place-items-center rounded-xl border border-border/60 bg-background/80",
              (selected || isAi) && "border-primary/40",
            )}
          >
            <Icon
              className={cn(
                "h-5 w-5 sm:h-6 sm:w-6",
                isAi || selected ? "text-primary" : "text-foreground",
              )}
              strokeWidth={1.75}
            />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold leading-tight text-foreground group-hover:text-primary">
              {type.title}
            </h3>
            {type.popular && (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning">
                <Flame className="h-3 w-3" />
                Топ
              </span>
            )}
            {isAi && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                AI
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground sm:text-xs">{type.subtitle}</p>
          <p className="mt-2 hidden line-clamp-2 text-xs leading-relaxed text-muted-foreground/80 sm:block">
            {type.tooltip}
          </p>
        </div>

        <ArrowRight
          className={cn(
            "mt-1 h-5 w-5 shrink-0 text-muted-foreground/40 transition group-hover:text-primary sm:absolute sm:right-4 sm:top-4 sm:mt-0",
            selected && "text-primary",
          )}
        />
      </div>
    </button>
  );
};

export default ContentTypeCard;
