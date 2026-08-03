import { Check, GitCompareArrows, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AUTO_FORMAT_ID,
  CREATIVE_FORMAT_CATEGORIES,
  CREATIVE_FORMATS,
  type CreativeFormat,
  type CreativeFormatId,
} from "@/data/creativeFormats";

const MAX_STYLES = 4;

interface CreativeFormatPickerProps {
  selected: CreativeFormatId[];
  onToggle: (id: CreativeFormatId) => void;
  /** Если задано — показываем только эти форматы (без категорий). */
  allowed?: CreativeFormatId[];
}

export function CreativeFormatPicker({
  selected,
  onToggle,
  allowed,
}: CreativeFormatPickerProps) {
  const pool = allowed?.length
    ? CREATIVE_FORMATS.filter((f) => allowed.includes(f.id))
    : CREATIVE_FORMATS;

  const selectedFormats = selected
    .map((id) => CREATIVE_FORMATS.find((f) => f.id === id))
    .filter((f): f is CreativeFormat => Boolean(f));

  const compact = Boolean(allowed?.length);

  if (compact) {
    return (
      <div className="space-y-4">
        <div className={cn("grid gap-3", pool.length <= 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-2")}>
          {pool.map((format) => {
            const Icon = format.icon ?? (format.id === "before_after" ? GitCompareArrows : Wand2);
            const isSelected = selected.includes(format.id);
            const order = isSelected ? selected.indexOf(format.id) + 1 : null;
            const isAuto = format.id === AUTO_FORMAT_ID;

            return (
              <button
                key={format.id}
                type="button"
                onClick={() => onToggle(format.id)}
                aria-pressed={isSelected}
                aria-label={`${format.label}: ${format.subtitle}`}
                className={cn(
                  "group relative flex min-h-[8.5rem] flex-col overflow-hidden rounded-2xl border p-4 text-left transition-all duration-200",
                  "active:scale-[0.98] touch-manipulation",
                  isSelected
                    ? "border-primary bg-primary/10 shadow-[0_0_0_1px_hsl(var(--primary)/0.35),0_16px_32px_-14px_hsl(var(--primary)/0.5)]"
                    : "border-border/60 bg-card/50 hover:border-primary/40 hover:bg-card/80",
                  isAuto && !isSelected && "border-dashed border-primary/35",
                )}
              >
                <div
                  className={cn(
                    "pointer-events-none absolute inset-0 opacity-40",
                    `bg-gradient-to-br ${format.gradient}`,
                  )}
                />
                <div className="relative flex items-start justify-between gap-3">
                  <span
                    className={cn(
                      "grid h-12 w-12 place-items-center rounded-xl",
                      isSelected ? "bg-primary text-primary-foreground" : "bg-background/70 text-primary backdrop-blur",
                    )}
                  >
                    <Icon className="h-5 w-5" strokeWidth={1.75} />
                  </span>
                  {isSelected && order !== null ? (
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                      {order}
                    </span>
                  ) : (
                    <span className="grid h-6 w-6 place-items-center rounded-full border border-border/60 bg-background/40 text-transparent">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  )}
                </div>
                <div className="relative mt-auto space-y-1 pt-4">
                  <div className="flex items-center gap-2">
                    <h4 className="text-base font-semibold text-foreground">{format.label}</h4>
                    <span className="rounded-md bg-background/50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground backdrop-blur">
                      {format.tag}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{format.subtitle}</p>
                  <p className="text-xs leading-snug text-muted-foreground/90 line-clamp-2">{format.outputHint}</p>
                </div>
              </button>
            );
          })}
        </div>

        {selectedFormats.length > 0 && (
          <div className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-xs text-muted-foreground">
            {selectedFormats.map((f) => f.label).join(" · ")}
            {" — "}
            {selectedFormats.map((f) => f.outputHint).join("; ")}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {CREATIVE_FORMAT_CATEGORIES.map((cat) => {
        const formats = CREATIVE_FORMATS.filter((f) => f.category === cat.id);
        if (!formats.length) return null;

        return (
          <div key={cat.id}>
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{cat.label}</span>
              <span className="h-px flex-1 bg-border/60" />
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {formats.map((format) => {
                const Icon = format.icon;
                const isSelected = selected.includes(format.id);
                const order = isSelected ? selected.indexOf(format.id) + 1 : null;
                const isAuto = format.id === AUTO_FORMAT_ID;

                return (
                  <button
                    key={format.id}
                    type="button"
                    onClick={() => onToggle(format.id)}
                    aria-pressed={isSelected}
                    aria-label={`${format.label}: ${format.subtitle}`}
                    className={cn(
                      "group flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left transition",
                      isSelected
                        ? "border-primary/50 bg-primary/5 ring-1 ring-primary/30"
                        : "border-border/60 bg-card/60 hover:border-primary/40 hover:bg-card",
                      isAuto && !isSelected && "border-dashed border-primary/40",
                    )}
                  >
                    <span
                      className={cn(
                        "grid h-11 w-11 shrink-0 place-items-center rounded-xl",
                        isSelected ? "bg-primary/10 text-primary" : "bg-secondary/70 text-foreground",
                      )}
                    >
                      <Icon className="h-5 w-5" strokeWidth={1.75} />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <h4 className="truncate text-sm font-semibold text-foreground">{format.label}</h4>
                        <span className="shrink-0 rounded bg-secondary/60 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
                          {format.tag}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{format.subtitle}</p>
                    </div>

                    {isSelected && order !== null ? (
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{order}</span>
                    ) : (
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-border/60 text-transparent transition group-hover:text-muted-foreground">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {selectedFormats.length > 0 && (
        <div className="rounded-2xl border border-primary/25 bg-primary/5 p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary">Что сгенерируем</div>
          <ul className="space-y-2">
            {selectedFormats.map((f, i) => (
              <li key={f.id} className="flex gap-2 text-sm">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">{i + 1}</span>
                <div>
                  <span className="font-medium text-foreground">{f.label}</span>
                  <span className="text-muted-foreground"> — {f.outputHint}</span>
                </div>
              </li>
            ))}
          </ul>
          {selected.includes(AUTO_FORMAT_ID) && selected.length === 1 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Режим «Авто» эксклюзивный — для сравнения форматов выберите до {MAX_STYLES} конкретных вариантов без Авто.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
