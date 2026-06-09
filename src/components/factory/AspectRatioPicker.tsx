import { Check, FileText, Film, Monitor, Smartphone, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AspectId } from "@/data/contentTypeFlows";

const ASPECT_META: Record<
  AspectId,
  { label: string; sub: string; icon: typeof Square }
> = {
  "1:1": { label: "1:1", sub: "Квадрат", icon: Square },
  "4:5": { label: "4:5", sub: "Портрет", icon: Smartphone },
  "9:16": { label: "9:16", sub: "Stories / Reels", icon: Smartphone },
  "16:9": { label: "16:9", sub: "YouTube / баннер", icon: Monitor },
  "3:4": { label: "3:4", sub: "Портрет", icon: FileText },
  "21:9": { label: "21:9", sub: "Ultrawide", icon: Film },
};

interface Props {
  value: AspectId;
  onChange: (id: AspectId) => void;
  allowed: AspectId[];
}

export function AspectRatioPicker({ value, onChange, allowed }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {allowed.map((id) => {
        const a = ASPECT_META[id];
        const Icon = a.icon;
        const selected = value === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            aria-pressed={selected}
            className={cn(
              "relative flex flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 py-5 text-center transition-all",
              "hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-elevated",
              selected && "border-primary bg-primary/5 shadow-glow",
            )}
          >
            {selected && (
              <span className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground">
                <Check className="h-3 w-3" />
              </span>
            )}
            <Icon className={cn("h-7 w-7", selected ? "text-primary" : "text-primary/70")} />
            <div className="text-lg font-bold">{a.label}</div>
            <div className="text-[11px] text-muted-foreground">{a.sub}</div>
          </button>
        );
      })}
    </div>
  );
}
