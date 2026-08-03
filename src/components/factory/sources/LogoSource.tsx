import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { BadgeCheck, UploadCloud, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface LogoSourceProps {
  file: File | null;
  onChange: (file: File | null) => void;
  /** Не блокирует «Далее» — просто усиливает бренд на креативе. */
  optional?: boolean;
}

const ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml";

const LogoSource = ({ file, onChange, optional = false }: LogoSourceProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const pickFile = (incoming: File | null) => {
    if (!incoming) {
      onChange(null);
      return;
    }
    if (!incoming.type.startsWith("image/")) return;
    onChange(incoming);
  };

  const handleSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    pickFile(f);
    e.target.value = "";
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    pickFile(e.dataTransfer.files?.[0] ?? null);
  };

  const previewUrl = file ? URL.createObjectURL(file) : null;

  return (
    <div className="animate-fade-in-up">
      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary">
          <BadgeCheck className="h-4 w-4" />
        </span>
        Логотип бренда
        <span className="font-normal text-muted-foreground">
          {optional ? "(необязательно)" : "(достаточно для продолжения)"}
        </span>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {optional
          ? "Можно пропустить. Если загрузите — AI подхватит форму, цвета и стиль бренда на креативе."
          : "Загрузите логотип — этого хватит, чтобы перейти дальше. AI изучит форму, цвета и стиль бренда."}
      </p>

      {file && previewUrl ? (
        <div className="mt-3 flex items-center gap-4 rounded-2xl border border-border bg-secondary/30 p-4">
          <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-border bg-background">
            <img
              src={previewUrl}
              alt="Логотип"
              className="h-full w-full object-contain p-1"
              onLoad={() => URL.revokeObjectURL(previewUrl)}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{file.name}</p>
            <p className="text-xs text-muted-foreground">
              {(file.size / 1024).toFixed(0)} KB · загрузится в Storage → logo_url + image_urls[0]
            </p>
          </div>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border bg-background text-foreground hover:bg-secondary"
            aria-label="Удалить логотип"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={cn(
            "mt-3 flex min-h-[140px] cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-secondary/30 px-6 py-8 text-center transition-all",
            "hover:border-primary/60 hover:bg-secondary/50",
            dragOver && "border-primary bg-primary/5 shadow-glow",
          )}
        >
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15 text-primary">
            <UploadCloud className="h-5 w-5" />
          </span>
          <p className="text-sm">
            Перетащите логотип или <span className="font-semibold text-primary">выберите файл</span>
          </p>
          <p className="text-xs text-muted-foreground">PNG, JPG, WEBP, SVG до 10MB</p>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={handleSelect}
          />
        </div>
      )}
    </div>
  );
};

export default LogoSource;
