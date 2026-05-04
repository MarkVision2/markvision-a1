import { Link2 } from "lucide-react";

interface LinkSourceProps {
  value: string;
  onChange: (v: string) => void;
}

const SUGGESTIONS = [
  { id: "wb", label: "Wildberries", color: "bg-fuchsia-500" },
  { id: "kaspi", label: "Kaspi.kz", color: "bg-orange-500" },
];

const LinkSource = ({ value, onChange }: LinkSourceProps) => {
  return (
    <div className="animate-fade-in-up">
      <label htmlFor="source-url" className="flex items-center gap-2 text-sm font-medium">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary">
          <Link2 className="h-4 w-4" />
        </span>
        Ссылка на товар/статью/видео
      </label>

      <div className="relative mt-3">
        <Link2 className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          id="source-url"
          type="url"
          inputMode="url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://..."
          className="h-14 w-full rounded-2xl border border-border bg-secondary/40 pl-11 pr-4 text-base text-foreground placeholder:text-muted-foreground/70 outline-none transition-colors focus:border-primary/60 focus:bg-secondary/60"
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {SUGGESTIONS.map((s) => (
          <span
            key={s.id}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/50 px-3 py-1.5 text-xs text-muted-foreground"
          >
            <span className={`h-2 w-2 rounded-full ${s.color}`} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
};

export default LinkSource;