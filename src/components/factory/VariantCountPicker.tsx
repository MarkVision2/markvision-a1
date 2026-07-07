import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  value: number;
  onChange: (n: number) => void;
  counts: number[];
  unitLabel?: string;
}

export function VariantCountPicker({ value, onChange, counts, unitLabel = "вариантов" }: Props) {
  return (
    <div className="grid grid-cols-4 gap-2.5">
      {counts.map((n) => {
        const selected = value === n;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-pressed={selected}
            className={cn(
              "relative flex flex-col items-center justify-center gap-1 rounded-2xl border border-border bg-card px-4 py-5 transition-all",
              "hover:-translate-y-0.5 hover:border-primary/60",
              selected && "border-primary bg-primary/5 shadow-glow",
            )}
          >
            {selected && (
              <span className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground">
                <Check className="h-3 w-3" />
              </span>
            )}
            <div className={cn("text-2xl font-bold", selected ? "text-primary" : "text-foreground")}>
              {n}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {n === 1 ? `1 ${unitLabel.replace(/ов$/, "")}` : `${n} ${unitLabel}`}
            </div>
          </button>
        );
      })}
    </div>
  );
}
