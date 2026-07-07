import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface SourceModeCardProps {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  selected: boolean;
  onClick: () => void;
}

const SourceModeCard = ({ icon: Icon, title, subtitle, selected, onClick }: SourceModeCardProps) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={selected}
    className={cn(
      "group flex items-center gap-3 rounded-2xl border p-4 text-left transition",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      selected
        ? "border-primary/50 bg-primary/5 ring-1 ring-primary/30"
        : "border-border/60 bg-card/60 hover:border-primary/40 hover:bg-card",
    )}
  >
    <span
      className={cn(
        "grid h-11 w-11 shrink-0 place-items-center rounded-xl transition-colors",
        selected ? "bg-primary/10 text-primary" : "bg-secondary/70 text-foreground",
      )}
    >
      <Icon className="h-5 w-5" strokeWidth={1.75} />
    </span>
    <div className="min-w-0">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
    </div>
  </button>
);

export default SourceModeCard;
