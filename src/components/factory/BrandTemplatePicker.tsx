import { BookOpen } from "lucide-react";
import { useBrandTemplates } from "@/hooks/useBrandTemplates";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  value: string | null;
  onChange: (id: string | null) => void;
}

export function BrandTemplatePicker({ value, onChange }: Props) {
  const { templates, loading, projectId } = useBrandTemplates();

  if (!projectId) return null;

  return (
    <div className="rounded-2xl border border-border bg-card/60 p-4">
      <Label className="mb-2 flex items-center gap-2 text-sm font-medium">
        <BookOpen className="h-4 w-4 text-primary" />
        Шаблон бренда
      </Label>
      <Select
        value={value ?? "none"}
        onValueChange={(v) => onChange(v === "none" ? null : v)}
        disabled={loading}
      >
        <SelectTrigger className="h-11 rounded-xl">
          <SelectValue placeholder="Без шаблона" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Без шаблона</SelectItem>
          {templates.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {t.name}
              {t.is_default ? " (по умолчанию)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Логотип, цвета, шрифты и референсы из шаблона будут переданы в генератор.
      </p>
    </div>
  );
}
