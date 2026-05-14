import { Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ContentType } from "@/data/contentTypes";

interface ContentTypeCardProps {
  type: ContentType;
  selected: boolean;
  onSelect: (id: string) => void;
}

// Цветной glow за иконкой — мягкий, в тон категории
const GLOW_BY_ID: Record<string, string> = {
  "facebook-ads": "bg-[hsl(217_91%_60%/0.22)]",
  "google-ads": "bg-[hsl(0_84%_60%/0.18)]",
  "marketplace": "bg-[hsl(280_70%_60%/0.18)]",
  "insta-carousel": "bg-[hsl(330_80%_60%/0.18)]",
  "reels-cover": "bg-[hsl(260_80%_65%/0.18)]",
  "stories": "bg-[hsl(20_90%_60%/0.18)]",
  "youtube-thumb": "bg-[hsl(0_84%_55%/0.20)]",
  "web-banner": "bg-[hsl(190_80%_55%/0.18)]",
  "neuro-photo": "bg-primary/25",
};

const ContentTypeCard = ({ type, selected, onSelect }: ContentTypeCardProps) => {
  const Icon = type.icon;
  const isAi = type.category === "ai";
  const glow = GLOW_BY_ID[type.id] ?? "bg-primary/15";

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onSelect(type.id)}
          aria-pressed={selected}
          aria-label={`${type.title} — ${type.subtitle}`}
          className={cn(
            "group relative flex h-full min-h-[160px] flex-col items-start overflow-hidden rounded-3xl p-5 text-left",
            "border border-white/[0.06] bg-gradient-to-b from-white/[0.06] to-transparent",
            "transition-all duration-300 ease-out",
            "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_0_40px_-15px_hsl(var(--primary)/0.35)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            selected && "border-primary/50 shadow-[0_0_50px_-15px_hsl(var(--primary)/0.55)]",
          )}
        >
          {/* Popular */}
          {type.popular && (
            <span className="absolute right-3 top-3 z-10 inline-flex items-center gap-1 rounded-full border border-warning/25 bg-warning/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-warning">
              <Flame className="h-2.5 w-2.5" />
              Популярное
            </span>
          )}

          {/* AI badge */}
          {isAi && (
            <span className="absolute right-3 top-3 z-10 inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary">
              <span className="h-1 w-1 rounded-full bg-primary animate-pulse" />
              AI
            </span>
          )}

          {/* Icon with glow */}
          <div className="relative mb-5 h-14 w-14">
            <div
              aria-hidden
              className={cn(
                "absolute inset-0 rounded-full blur-xl transition-colors duration-300",
                glow,
                "group-hover:bg-primary/25",
                isAi && "bg-primary/30",
              )}
            />
            <div
              className={cn(
                "relative grid h-full w-full place-items-center rounded-2xl border border-white/10 bg-card transition-colors duration-300",
                "group-hover:border-primary/30",
                (selected || isAi) && "border-primary/40",
              )}
            >
              <Icon
                className={cn(
                  "h-6 w-6 text-foreground transition-colors duration-300",
                  isAi && "text-primary",
                  selected && "text-primary",
                )}
                strokeWidth={1.75}
              />
            </div>
          </div>

          {/* Text */}
          <h3 className="text-base font-bold tracking-tight text-foreground transition-colors duration-300 group-hover:text-primary">
            {type.title}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">{type.subtitle}</p>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[260px] text-xs">
        {type.tooltip}
      </TooltipContent>
    </Tooltip>
  );
};

export default ContentTypeCard;
