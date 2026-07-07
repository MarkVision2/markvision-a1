import { ArrowRight, Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ContentType } from "@/data/contentTypes";
import { BrandIcon, hasBrandIcon } from "./BrandIcon";

interface ContentTypeCardProps {
  type: ContentType;
  selected: boolean;
  onSelect: (id: string) => void;
}

const ContentTypeCard = ({ type, selected, onSelect }: ContentTypeCardProps) => {
  const Icon = type.icon;
  const isAi = type.category === "ai";
  return (
    <button
      type="button"
      onClick={() => onSelect(type.id)}
      aria-pressed={selected}
      title={type.tooltip}
      className={cn(
        "group flex w-full items-center gap-3 rounded-2xl border border-border/60 bg-card/60 p-4 text-left transition",
        "hover:border-primary/40 hover:bg-card active:scale-[0.99]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected && "border-primary/50 bg-primary/5 ring-1 ring-primary/30",
      )}
    >
      {hasBrandIcon(type.id) ? (
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/[0.03] ring-1 ring-border/50">
          <BrandIcon id={type.id} className="h-8 w-8" />
        </span>
      ) : (
        <span
          className={cn(
            "grid h-12 w-12 shrink-0 place-items-center rounded-xl",
            isAi || selected ? "bg-primary/10 text-primary" : "bg-secondary/70 text-foreground",
          )}
        >
          <Icon className="h-6 w-6" strokeWidth={1.75} />
        </span>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <h3 className="truncate text-[15px] font-semibold leading-snug group-hover:text-primary">{type.title}</h3>
          {type.popular && (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-warning/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-warning">
              <Flame className="h-2.5 w-2.5" /> Топ
            </span>
          )}
          {isAi && (
            <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary">AI</span>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{type.subtitle}</p>
      </div>

      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/40 transition group-hover:translate-x-0.5 group-hover:text-primary" />
    </button>
  );
};

export default ContentTypeCard;
