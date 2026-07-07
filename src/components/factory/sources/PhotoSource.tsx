import { useRef, useState, type DragEvent, type ChangeEvent } from "react";
import { Image as ImageIcon, UploadCloud, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface PhotoSourceProps {
  files: File[];
  onChange: (files: File[]) => void;
  title?: string;
  subtitle?: string;
  hint?: string;
  maxFiles?: number;
}

const DEFAULT_MAX = 14;
const ACCEPT = "image/png,image/jpeg,image/webp";

const PhotoSource = ({
  files,
  onChange,
  title = "Загрузите изображения",
  subtitle,
  hint = "PNG, JPG, WEBP до 10MB каждый",
  maxFiles = DEFAULT_MAX,
}: PhotoSourceProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const addFiles = (incoming: FileList | File[]) => {
    const arr = Array.from(incoming).filter((f) => f.type.startsWith("image/"));
    const next = [...files, ...arr].slice(0, maxFiles);
    onChange(next);
  };

  const handleSelect = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = "";
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
  };

  const removeAt = (idx: number) => {
    onChange(files.filter((_, i) => i !== idx));
  };

  return (
    <div className="animate-fade-in-up">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary">
          <ImageIcon className="h-4 w-4" />
        </span>
        {title}
        <span className="font-normal text-muted-foreground">
          {subtitle ?? `(до ${maxFiles} файлов)`}
        </span>
      </div>
      {hint ? (
        <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>
      ) : null}

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
          "mt-3 flex min-h-[200px] cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border/60 bg-card/40 px-6 py-10 text-center transition",
          "hover:border-primary/40 hover:bg-secondary/40",
          dragOver && "border-primary/50 bg-primary/5",
        )}
      >
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/15 text-primary">
          <UploadCloud className="h-6 w-6" />
        </span>
        <p className="text-sm sm:text-base">
          Перетащите файлы,{" "}
          <span className="font-semibold text-foreground">Ctrl+V</span> или{" "}
          <span className="font-semibold text-primary">нажмите</span>
        </p>
        <p className="text-xs text-muted-foreground">
          PNG, JPG, WEBP до 10MB каждый
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={handleSelect}
        />
      </div>

      {files.length > 0 && (
        <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-5">
          {files.map((file, idx) => {
            const url = URL.createObjectURL(file);
            return (
              <div
                key={`${file.name}-${idx}`}
                className="group relative aspect-square overflow-hidden rounded-xl border border-border bg-secondary/40"
              >
                <img
                  src={url}
                  alt={file.name}
                  className="h-full w-full object-cover"
                  onLoad={() => URL.revokeObjectURL(url)}
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeAt(idx);
                  }}
                  className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-background/80 text-foreground opacity-0 backdrop-blur transition-opacity group-hover:opacity-100"
                  aria-label={`Удалить ${file.name}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PhotoSource;