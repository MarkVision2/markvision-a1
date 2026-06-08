import { CONTENT_TYPES, type ContentCategory } from "@/data/contentTypes";
import ContentTypeCard from "./ContentTypeCard";
import { cn } from "@/lib/utils";

interface ContentTypeGridProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const SECTIONS: {
  key: ContentCategory;
  label: string;
  hint: string;
  accent: string;
}[] = [
  { key: "ads", label: "Реклама", hint: "Meta, Google, WB", accent: "from-blue-500/10" },
  { key: "content", label: "Контент", hint: "Stories, Reels, YouTube", accent: "from-violet-500/10" },
  { key: "ai", label: "Нейрофото", hint: "AI с лицом", accent: "from-primary/10" },
];

const ContentTypeGrid = ({ selectedId, onSelect }: ContentTypeGridProps) => {
  return (
    <section className="space-y-6 pb-2 sm:space-y-8 sm:pb-4" aria-labelledby="content-type-title">
      <h2 id="content-type-title" className="sr-only">
        Выберите формат креатива
      </h2>

      {SECTIONS.map((section) => {
        const items = CONTENT_TYPES.filter((t) => t.category === section.key);
        if (items.length === 0) return null;

        return (
          <div
            key={section.key}
            className={cn(
              "rounded-2xl border border-border/40 bg-gradient-to-b p-3 sm:p-4",
              section.accent,
              "to-transparent",
            )}
          >
            <div className="mb-3 flex items-center justify-between gap-2 px-0.5">
              <div className="flex items-center gap-2 min-w-0">
                <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
                  {section.label}
                </h3>
                <span className="shrink-0 rounded-full bg-background/80 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {items.length}
                </span>
              </div>
              <span className="hidden text-xs text-muted-foreground sm:inline">{section.hint}</span>
            </div>
            <p className="mb-3 text-[11px] text-muted-foreground sm:hidden">{section.hint}</p>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
              {items.map((type) => (
                <ContentTypeCard
                  key={type.id}
                  type={type}
                  selected={selectedId === type.id}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
};

export default ContentTypeGrid;
