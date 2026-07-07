import { CONTENT_TYPES, type ContentCategory } from "@/data/contentTypes";
import ContentTypeCard from "./ContentTypeCard";

interface ContentTypeGridProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const SECTIONS: { key: ContentCategory; label: string; hint: string }[] = [
  { key: "ads", label: "Реклама", hint: "Meta, Google, маркетплейсы" },
  { key: "content", label: "Контент", hint: "Stories, Reels, YouTube" },
  { key: "ai", label: "Нейрофото", hint: "AI-фото с вашим лицом" },
];

const ContentTypeGrid = ({ selectedId, onSelect }: ContentTypeGridProps) => (
  <section className="space-y-7 pb-2" aria-label="Выбор формата креатива">
    {SECTIONS.map((section) => {
      const items = CONTENT_TYPES.filter((t) => t.category === section.key);
      if (items.length === 0) return null;
      return (
        <div key={section.key}>
          <div className="mb-3 flex items-baseline gap-2 px-0.5">
            <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">{section.label}</h3>
            <span className="truncate text-xs text-muted-foreground">· {section.hint}</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((type) => (
              <ContentTypeCard key={type.id} type={type} selected={selectedId === type.id} onSelect={onSelect} />
            ))}
          </div>
        </div>
      );
    })}
  </section>
);

export default ContentTypeGrid;
