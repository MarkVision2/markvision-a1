import { Check } from "lucide-react";
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
}

export function CreativeFormatPicker({ selected, onToggle }: CreativeFormatPickerProps) {
  const selectedFormats = selected
    .map((id) => CREATIVE_FORMATS.find((f) => f.id === id))
    .filter((f): f is CreativeFormat => Boolean(f));

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
