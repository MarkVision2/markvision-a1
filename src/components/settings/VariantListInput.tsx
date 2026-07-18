import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CODEWORD_MAX_VARIANTS, normalizeVariantList } from "@/lib/codewordVariants";

interface VariantListInputProps {
  label: string;
  hint: string;
  placeholder: string;
  items: string[];
  onChange: (items: string[]) => void;
  multiline?: boolean;
}

export function VariantListInput({ label, hint, placeholder, items, onChange, multiline }: VariantListInputProps) {
  const rows = items.length > 0 ? items : [""];

  const setRow = (index: number, value: string) => {
    const next = [...rows];
    next[index] = value;
    onChange(next);
  };

  const addRow = () => {
    if (rows.length >= CODEWORD_MAX_VARIANTS) return;
    onChange([...rows, ""]);
  };

  const removeRow = (index: number) => {
    const next = rows.filter((_, i) => i !== index);
    onChange(next.length > 0 ? next : [""]);
  };

  const filled = normalizeVariantList(rows).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <Label>{label}</Label>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
        </div>
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {filled}/{CODEWORD_MAX_VARIANTS}
        </span>
      </div>
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex gap-2">
            <span className="mt-2.5 w-5 shrink-0 text-center text-[10px] font-semibold tabular-nums text-muted-foreground">
              {i + 1}
            </span>
            {multiline ? (
              <Textarea
                placeholder={placeholder}
                value={row}
                onChange={(e) => setRow(i, e.target.value)}
                rows={2}
                className="min-h-[60px] resize-none text-sm"
              />
            ) : (
              <Input
                placeholder={placeholder}
                value={row}
                onChange={(e) => setRow(i, e.target.value)}
                className="text-sm"
              />
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mt-0.5 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => removeRow(i)}
              disabled={rows.length === 1 && !row.trim()}
              aria-label="Удалить вариант"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
      {rows.length < CODEWORD_MAX_VARIANTS && (
        <Button type="button" variant="outline" size="sm" className="gap-1.5 rounded-lg" onClick={addRow}>
          <Plus className="h-3.5 w-3.5" />
          Добавить вариант
        </Button>
      )}
    </div>
  );
}
