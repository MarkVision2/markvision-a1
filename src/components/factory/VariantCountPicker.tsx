import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  value: number;
  onChange: (n: number) => void;
  counts: number[];
  unitLabel?: string;
}

const HINT: Record<number, string> = {
  3: "Быстрый тест",
  5: "Баланс",
  7: "Широкий охват",
  10: "Максимум A/B",
};

export function VariantCountPicker({ value, onChange, counts, unitLabel = "вариантов" }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {counts.map((n) => {
        const on = value === n;
        const dots = Math.min(n, 8);
        const hint = HINT[n] ?? (n === 1 ? `1 ${unitLabel.replace(/ов$/, "")}` : `${n} ${unitLabel}`);
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-pressed={on}
            className={cn(
              "group relative flex min-h-[6.5rem] flex-col items-center justify-center gap-2.5 rounded-2xl border px-3 py-4 text-center transition-all duration-200",
              "active:scale-[0.98] touch-manipulation",
              on
                ? "border-primary bg-primary/10 shadow-[0_0_0_1px_hsl(var(--primary)/0.35),0_12px_28px_-12px_hsl(var(--primary)/0.55)]"
                : "border-border/60 bg-card/40 hover:border-primary/40 hover:bg-card/70",
            )}
          >
            {on && (
              <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
            )}

            <div className="flex items-end justify-center gap-1 px-1" aria-hidden>
              {Array.from({ length: dots }).map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    "w-1.5 rounded-full transition-colors",
                    on ? "bg-primary" : "bg-muted-foreground/35 group-hover:bg-primary/50",
                  )}
                  style={{ height: `${10 + (i % 4) * 4}px` }}
                />
              ))}
            </div>

            <div className="space-y-0.5">
              <p className={cn("text-2xl font-bold tabular-nums leading-none tracking-tight", on ? "text-primary" : "text-foreground")}>
                {n}
              </p>
              <p className="text-[11px] text-muted-foreground">{hint}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
