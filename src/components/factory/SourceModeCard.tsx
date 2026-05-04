import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface SourceModeCardProps {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  selected: boolean;
  onClick: () => void;
}

const SourceModeCard = ({
  icon: Icon,
  title,
  subtitle,
  selected,
  onClick,
}: SourceModeCardProps) => {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "group relative flex flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border border-border bg-card px-6 py-7 text-center",
        "transition-all duration-300 ease-out",
        "hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-elevated",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        selected && "border-primary bg-gradient-card-hover shadow-glow",
      )}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-gradient-card-hover"
      />
      <span
        className={cn(
          "relative grid h-12 w-12 place-items-center rounded-xl border border-border bg-secondary/60 transition-colors",
          "group-hover:border-primary/50 group-hover:text-primary",
          selected && "border-primary/70 bg-primary/15 text-primary",
        )}
      >
        <Icon className="h-6 w-6" strokeWidth={1.75} />
      </span>
      <div className="relative">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </button>
  );
};

export default SourceModeCard;