import { FileText, Info } from "lucide-react";

interface DescriptionSourceProps {
  value: string;
  onChange: (v: string) => void;
  productName: string;
  onProductNameChange: (v: string) => void;
}

const DescriptionSource = ({
  value,
  onChange,
  productName,
  onProductNameChange,
}: DescriptionSourceProps) => {
  return (
    <div className="animate-fade-in-up space-y-8">
      <div>
        <label htmlFor="main-description" className="flex items-center gap-2 text-sm font-medium">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary">
            <FileText className="h-4 w-4" />
          </span>
          Главное описание
        </label>
        <textarea
          id="main-description"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={6}
          placeholder="Основная идея дизайна или текст поста..."
          className="mt-3 w-full resize-none rounded-2xl border border-border/60 bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/70 outline-none transition-colors focus:border-primary/50"
        />
      </div>

      <div>
        <label htmlFor="product-name" className="flex items-center gap-2 text-sm font-medium">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary">
            <Info className="h-4 w-4" />
          </span>
          Название товара
        </label>
        <input
          id="product-name"
          type="text"
          value={productName}
          onChange={(e) => onProductNameChange(e.target.value)}
          placeholder="Например: Увлажнитель воздуха, Кроссовки Nike..."
          className="mt-3 h-12 w-full rounded-2xl border border-border/60 bg-background px-4 text-sm text-foreground placeholder:text-muted-foreground/70 outline-none transition-colors focus:border-primary/50"
        />
      </div>
    </div>
  );
};

export default DescriptionSource;