import { Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ContentType } from "@/data/contentTypes";

interface ContentTypeCardProps {
  type: ContentType;
  selected: boolean;
  onSelect: (id: string) => void;
}

const ContentTypeCard = ({ type, selected, onSelect }: ContentTypeCardProps) => {
  const Icon = type.icon;

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onSelect(type.id)}
          aria-pressed={selected}
          aria-label={`${type.title} — ${type.subtitle}`}
          className={cn(
            "group relative flex h-full min-h-[140px] flex-col items-center justify-center gap-2.5 overflow-hidden rounded-2xl border border-border bg-card p-3 text-center",
            "transition-all duration-300 ease-out",
            "hover:-translate-y-0.5 hover:scale-[1.02] hover:border-primary/60 hover:shadow-elevated",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            selected && "border-primary bg-gradient-card-hover shadow-glow",
          )}
        >
          {/* Hover glow overlay */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-gradient-card-hover"
          />

          {/* Popular badge */}
          {type.popular && (
            <span className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[9px] font-medium text-warning">
              <Flame className="h-3 w-3" />
              Популярное
            </span>
          )}

          {/* Icon */}
          <span
            className={cn(
              "relative grid h-11 w-11 place-items-center rounded-xl border border-border bg-secondary/60 transition-colors duration-300",
              "group-hover:border-primary/50 group-hover:text-primary",
              selected && "border-primary/70 bg-primary/15 text-primary",
            )}
          >
            <Icon className="h-5 w-5" strokeWidth={1.75} />
          </span>

          <div className="relative">
            <h3 className="text-sm font-semibold text-foreground">
              {type.title}
            </h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {type.subtitle}
            </p>
          </div>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[260px] text-xs">
        {type.tooltip}
      </TooltipContent>
    </Tooltip>
  );
};

export default ContentTypeCard;