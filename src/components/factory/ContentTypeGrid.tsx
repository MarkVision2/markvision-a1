import { CONTENT_TYPES } from "@/data/contentTypes";
import ContentTypeCard from "./ContentTypeCard";

interface ContentTypeGridProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const ContentTypeGrid = ({ selectedId, onSelect }: ContentTypeGridProps) => {
  return (
    <section className="container pb-6" aria-labelledby="content-type-title">
      <div className="mb-3 text-center sm:mb-4">
        <h2 id="content-type-title" className="text-base font-semibold tracking-tight sm:text-lg">
          Выберите, что хотите создать
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Система автоматически подберет структуру и стиль
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
        {CONTENT_TYPES.map((type) => (
          <ContentTypeCard
            key={type.id}
            type={type}
            selected={selectedId === type.id}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
};

export default ContentTypeGrid;