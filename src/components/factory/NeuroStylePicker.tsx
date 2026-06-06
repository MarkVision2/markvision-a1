import { useState } from "react";
import { Check, Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MAX_NEURO_STYLES,
  NEURO_ANGLES,
  NEURO_STYLES,
  type AngleId,
  type NeuroStyleId,
} from "@/data/neuroStyles";
import { toast } from "sonner";

const AUTO_ID: NeuroStyleId = "auto";

function StylePreview({ preview, seed, label }: { preview: string; seed: string; label: string }) {
  const [errored, setErrored] = useState(false);
  const src = errored ? `https://picsum.photos/seed/${seed}/400/300` : preview;
  return (
    <img
      src={src}
      alt={label}
      onError={() => setErrored(true)}
      className="h-full w-full object-cover"
      loading="lazy"
    />
  );
}

interface Props {
  selectedStyles: NeuroStyleId[];
  onStylesChange: (ids: NeuroStyleId[]) => void;
  selectedAngles: AngleId[];
  onAnglesChange: (ids: AngleId[]) => void;
}

export function NeuroStylePicker({
  selectedStyles,
  onStylesChange,
  selectedAngles,
  onAnglesChange,
}: Props) {
  const toggleStyle = (id: NeuroStyleId) => {
    onStylesChange(
      (() => {
        if (id === AUTO_ID) return selectedStyles.includes(AUTO_ID) ? selectedStyles : [AUTO_ID];
        const base = selectedStyles.filter((s) => s !== AUTO_ID);
        if (base.includes(id)) {
          if (base.length === 1) {
            toast.error("Минимум 1 стиль");
            return selectedStyles;
          }
          return base.filter((s) => s !== id);
        }
        if (base.length >= MAX_NEURO_STYLES) {
          toast.error(`Максимум ${MAX_NEURO_STYLES} стиля`);
          return selectedStyles;
        }
        return [...base, id];
      })(),
    );
  };

  const toggleAngle = (id: AngleId) => {
    onAnglesChange(
      selectedAngles.includes(id)
        ? selectedAngles.filter((a) => a !== id)
        : [...selectedAngles, id],
    );
  };

  return (
    <div className="space-y-8">
      <div>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Palette className="h-4 w-4 text-primary" />
            Стиль фотосессии
          </div>
          <span className="text-xs text-muted-foreground">
            {selectedStyles.length} / {MAX_NEURO_STYLES}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {NEURO_STYLES.map((s) => {
            const Icon = s.icon;
            const selected = selectedStyles.includes(s.id);
            const order = selected ? selectedStyles.indexOf(s.id) + 1 : null;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => toggleStyle(s.id)}
                className={cn(
                  "overflow-hidden rounded-2xl border text-left transition-all",
                  selected ? "border-primary ring-2 ring-primary/50" : "border-border hover:border-primary/40",
                )}
              >
                <div className="relative aspect-[4/3] bg-secondary/30">
                  <StylePreview preview={s.preview} seed={s.fallbackSeed} label={s.label} />
                  {selected && order !== null && (
                    <span className="absolute left-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                      {order}
                    </span>
                  )}
                </div>
                <div className="flex items-start gap-2 p-3">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div>
                    <div className="text-sm font-semibold">{s.label}</div>
                    <div className="text-[11px] text-muted-foreground line-clamp-2">{s.description}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-3 text-sm font-medium">Ракурсы</p>
        <div className="flex flex-wrap gap-2">
          {NEURO_ANGLES.map((a) => {
            const selected = selectedAngles.includes(a.id);
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => toggleAngle(a.id)}
                className={cn(
                  "rounded-xl border px-3 py-2 text-sm font-medium transition-all",
                  selected ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary/40",
                )}
              >
                {selected && <Check className="mr-1 inline h-3.5 w-3.5" />}
                {a.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
