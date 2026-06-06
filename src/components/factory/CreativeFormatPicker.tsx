import { Check, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AUTO_FORMAT_ID,
  CREATIVE_FORMAT_CATEGORIES,
  CREATIVE_FORMATS,
  type CreativeFormat,
  type CreativeFormatId,
} from "@/data/creativeFormats";

const MAX_STYLES = 4;

function FormatPreviewArt({ format }: { format: CreativeFormat }) {
  const base = cn(
    "absolute inset-0 bg-gradient-to-br opacity-90 transition-opacity",
    format.gradient,
  );

  if (format.id === "testimonial") {
    return (
      <div className={base}>
        <div className="absolute left-3 top-3 h-10 w-10 rounded-full bg-white/25 ring-2 ring-white/30" />
        <div className="absolute bottom-4 left-3 right-3 rounded-xl bg-white/20 p-2 backdrop-blur-sm">
          <div className="mb-1 flex gap-0.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <span key={i} className="text-[8px] text-amber-300">
                ★
              </span>
            ))}
          </div>
          <div className="h-1.5 w-4/5 rounded bg-white/50" />
          <div className="mt-1 h-1 w-2/5 rounded bg-white/30" />
        </div>
      </div>
    );
  }

  if (format.id === "ugc") {
    return (
      <div className={base}>
        <div className="absolute inset-x-4 top-6 h-24 rounded-2xl border border-white/20 bg-black/20" />
        <div className="absolute bottom-5 left-1/2 h-14 w-14 -translate-x-1/2 rounded-full bg-white/20 ring-2 ring-white/30" />
        <div className="absolute bottom-16 left-1/2 h-8 w-8 -translate-x-1/2 rounded-lg bg-white/30" />
      </div>
    );
  }

  if (format.id === "before_after") {
    return (
      <div className={base}>
        <div className="absolute inset-y-3 left-3 w-[calc(50%-14px)] rounded-lg bg-black/30" />
        <div className="absolute inset-y-3 right-3 w-[calc(50%-14px)] rounded-lg bg-white/25" />
        <div className="absolute left-1/2 top-1/2 grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/30 text-[10px] font-bold text-white">
          →
        </div>
      </div>
    );
  }

  if (format.id === "product_focus") {
    return (
      <div className={base}>
        <div className="absolute left-1/2 top-1/2 h-16 w-12 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white/35 shadow-lg" />
        <div className="absolute bottom-4 left-4 h-3 w-8 rounded bg-white/20" />
        <div className="absolute right-4 top-4 h-6 w-6 rounded-full bg-white/15" />
      </div>
    );
  }

  if (format.id === "bold_offer") {
    return (
      <div className={base}>
        <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 space-y-2">
          <div className="h-4 rounded bg-white/60" />
          <div className="h-3 w-3/4 rounded bg-white/40" />
          <div className="h-2 w-1/2 rounded bg-white/25" />
        </div>
      </div>
    );
  }

  if (format.id === "expert") {
    return (
      <div className={base}>
        <div className="absolute left-1/2 top-5 h-20 w-20 -translate-x-1/2 rounded-full bg-white/20 ring-2 ring-white/25" />
        <div className="absolute bottom-4 left-4 right-4 h-2 rounded bg-white/30" />
        <div className="absolute bottom-8 left-1/3 right-1/3 h-1.5 rounded bg-white/20" />
      </div>
    );
  }

  // auto + fallback
  return (
    <div className={base}>
      <div className="absolute inset-0 flex items-center justify-center">
        <Sparkles className="h-10 w-10 text-white/50" />
      </div>
      <div className="absolute bottom-3 left-3 right-3 flex gap-1">
        <div className="h-2 flex-1 rounded bg-white/30" />
        <div className="h-2 flex-1 rounded bg-white/20" />
        <div className="h-2 flex-1 rounded bg-white/15" />
      </div>
    </div>
  );
}

interface CreativeFormatPickerProps {
  selected: CreativeFormatId[];
  onToggle: (id: CreativeFormatId) => void;
}

export function CreativeFormatPicker({ selected, onToggle }: CreativeFormatPickerProps) {
  const selectedFormats = selected
    .map((id) => CREATIVE_FORMATS.find((f) => f.id === id))
    .filter((f): f is CreativeFormat => Boolean(f));

  return (
    <div className="space-y-6">
      {CREATIVE_FORMAT_CATEGORIES.map((cat) => {
        const formats = CREATIVE_FORMATS.filter((f) => f.category === cat.id);
        if (!formats.length) return null;

        return (
          <div key={cat.id}>
            <div className="mb-3 flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {cat.label}
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>

            <div
              className={cn(
                "grid gap-3",
                cat.id === "recommended"
                  ? "grid-cols-1 sm:grid-cols-2"
                  : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
              )}
            >
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
                      "group relative flex w-full flex-col overflow-hidden rounded-2xl border text-left transition-all duration-300",
                      "hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-elevated",
                      isSelected
                        ? "border-primary shadow-glow ring-2 ring-primary/50"
                        : "border-border bg-card",
                      isAuto && !isSelected && "border-dashed border-primary/30 bg-primary/5",
                      cat.id === "recommended" ? "min-h-[200px]" : "min-h-[168px]",
                    )}
                  >
                    <div
                      className={cn(
                        "relative overflow-hidden bg-secondary/30",
                        cat.id === "recommended" ? "aspect-[16/9]" : "aspect-[4/3]",
                      )}
                    >
                      <FormatPreviewArt format={format} />
                      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-card via-transparent to-transparent" />

                      <span
                        className={cn(
                          "absolute left-2.5 top-2.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide backdrop-blur-sm",
                          isSelected ? "bg-primary text-primary-foreground" : "bg-black/40 text-white/90",
                        )}
                      >
                        {format.tag}
                      </span>

                      {isSelected && order !== null && (
                        <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground shadow-glow">
                          {order}
                        </span>
                      )}

                      {!isSelected && (
                        <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full border border-white/40 bg-black/20 opacity-0 transition-opacity group-hover:opacity-100">
                          <Check className="h-3 w-3 text-white/80" />
                        </span>
                      )}
                    </div>

                    <div className="flex flex-1 flex-col gap-1 p-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "grid h-7 w-7 shrink-0 place-items-center rounded-lg",
                            isSelected ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary",
                          )}
                        >
                          <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold leading-tight text-foreground">
                            {format.label}
                          </div>
                          <div className="text-[11px] leading-snug text-muted-foreground">
                            {format.subtitle}
                          </div>
                        </div>
                      </div>
                      {cat.id === "recommended" && (
                        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                          {format.description}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {selectedFormats.length > 0 && (
        <div className="rounded-2xl border border-primary/25 bg-primary/5 p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary">
            Что сгенерируем
          </div>
          <ul className="space-y-2">
            {selectedFormats.map((f, i) => (
              <li key={f.id} className="flex gap-2 text-sm">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">
                  {i + 1}
                </span>
                <div>
                  <span className="font-medium text-foreground">{f.label}</span>
                  <span className="text-muted-foreground"> — {f.outputHint}</span>
                </div>
              </li>
            ))}
          </ul>
          {selected.includes(AUTO_FORMAT_ID) && selected.length === 1 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Режим «Авто» эксклюзивный — для сравнения форматов выберите до {MAX_STYLES} конкретных
              вариантов без Авто.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
