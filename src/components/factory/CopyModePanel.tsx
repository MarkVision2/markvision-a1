import { FileText, Sparkles, Type } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CopyMode } from "@/lib/contentFactoryCopy";

interface Props {
  mode: CopyMode;
  onModeChange: (mode: CopyMode) => void;
  overlayText: string;
  onOverlayTextChange: (text: string) => void;
  extraHints: string;
  onExtraHintsChange: (text: string) => void;
}

const OPTIONS: {
  id: CopyMode;
  title: string;
  subtitle: string;
  icon: typeof Sparkles;
}[] = [
  {
    id: "auto",
    title: "Быстро",
    subtitle: "AI сам напишет сценарий",
    icon: Sparkles,
  },
  {
    id: "custom",
    title: "Вставить свой текст",
    subtitle: "Точный текст на фото",
    icon: Type,
  },
];

export function CopyModePanel({
  mode,
  onModeChange,
  overlayText,
  onOverlayTextChange,
  extraHints,
  onExtraHintsChange,
}: Props) {
  return (
    <div className="border-t border-border pt-8">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary">
          <FileText className="h-4 w-4" />
        </span>
        Текст на креативе
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        Как формировать подпись и текст на изображении
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const selected = mode === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onModeChange(opt.id)}
              aria-pressed={selected}
              className={cn(
                "flex flex-col items-start gap-2 rounded-2xl border border-border bg-card px-5 py-4 text-left transition-all",
                "hover:border-primary/40",
                selected && "border-primary/60 bg-primary/5",
              )}
            >
              <span
                className={cn(
                  "grid h-10 w-10 place-items-center rounded-xl bg-secondary/60 text-primary/80",
                  selected && "bg-primary/15 text-primary",
                )}
              >
                <Icon className="h-5 w-5" />
              </span>
              <div>
                <p className="font-semibold text-foreground">{opt.title}</p>
                <p className="text-xs text-muted-foreground">{opt.subtitle}</p>
              </div>
            </button>
          );
        })}
      </div>

      {mode === "custom" ? (
        <div className="mt-4">
          <label htmlFor="overlay-text" className="text-sm font-medium text-foreground">
            Ваш текст для наложения на фото *
          </label>
          <p className="mt-1 text-xs text-muted-foreground">
            Система использует этот текст дословно — без перефразирования AI
          </p>
          <textarea
            id="overlay-text"
            value={overlayText}
            onChange={(e) => onOverlayTextChange(e.target.value)}
            placeholder="Например: Скидка 30% только до пятницы! Запишитесь на бесплатную консультацию"
            rows={5}
            className="mt-3 w-full resize-none rounded-2xl border border-border bg-secondary/40 px-5 py-4 text-sm text-foreground placeholder:text-muted-foreground/70 outline-none transition-colors focus:border-primary/60 focus:bg-secondary/60"
          />
        </div>
      ) : (
        <div className="mt-4">
          <label htmlFor="copy-hints" className="text-sm font-medium text-foreground">
            Пожелания для AI (необязательно)
          </label>
          <textarea
            id="copy-hints"
            value={extraHints}
            onChange={(e) => onExtraHintsChange(e.target.value)}
            placeholder="Акцент на преимуществах, яркие цвета, строгий стиль..."
            rows={3}
            className="mt-3 w-full resize-none rounded-2xl border border-border bg-secondary/40 px-5 py-4 text-sm text-foreground placeholder:text-muted-foreground/70 outline-none transition-colors focus:border-primary/60 focus:bg-secondary/60"
          />
        </div>
      )}
    </div>
  );
}
